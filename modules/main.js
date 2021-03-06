/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

var BASE = 'extensions.no-duplicated-authentication@clear-code.com.';
var prefs = require('lib/prefs').prefs;
{
  prefs.setDefaultPref(BASE + 'debug',        false);
  prefs.setDefaultPref(BASE + 'proxy',        true);
  prefs.setDefaultPref(BASE + 'password',     true);
  prefs.setDefaultPref(BASE + 'withoutRealm', true);
  prefs.setDefaultPref(BASE + 'withRealm',    true);
  prefs.setDefaultPref(BASE + 'delay',        100);
  prefs.setDefaultPref(BASE + 'maxRetry',     10);
}

var log = require('log').log;

load('lib/WindowManager');
var timer = Cu.import('resource://gre/modules/Timer.jsm', {});


function toMatcher(aPatternString) {
  var expression = aPatternString.replace(/([\.\*\+\(\)\{\}\[\]])/g, '\\$1')
                                 .replace(/\%([0-9]+\$)?S/g, '.*');
  return new RegExp('^' + expression + '$');
}

var proxyAuthMatcher;
var passwordMatcher;
var authWithoutRealmMatcher;
var authWithRealmMatcher;
{
  let bundle = Cc['@mozilla.org/intl/stringbundle;1']
                .getService(Ci.nsIStringBundleService)
                .createBundle('chrome://global/locale/commonDialogs.properties');
  proxyAuthMatcher        = toMatcher(bundle.GetStringFromName('EnterLoginForProxy'))
  passwordMatcher         = toMatcher(bundle.GetStringFromName('EnterPasswordFor'))
  authWithoutRealmMatcher = toMatcher(bundle.GetStringFromName('EnterUserPasswordFor'))
  authWithRealmMatcher    = toMatcher(bundle.GetStringFromName('EnterLoginForRealm'))
  log('initialized matchers: ' + JSON.stringify({
    proxyAuthMatcher        : proxyAuthMatcher.source,
    passwordMatcher         : passwordMatcher.source,
    authWithoutRealmMatcher : authWithoutRealmMatcher.source,
    authWithRealmMatcher    : authWithRealmMatcher.source
  }));
}

var dialogsFor = {};
function hookAcceptButton(aDialog)
{
  var args = aDialog.args;
  var key = args.title + '\n' + args.text;
  dialogsFor[key] = dialogsFor[key] || [];
  dialogsFor[key].push(aDialog);

  var originalOnAccept = aDialog.onButton0;
  aDialog.onButton0 = function(...aArgs) {
    if (!dialogsFor) // after uninstalled or disabled
      return originalOnAccept.call(this, ...aArgs);

    var username = aDialog.ui.loginTextbox.value;
    var password = aDialog.ui.password1Textbox.value;

    log('authenticated: ' + args.text + ', username = ' + username + ', password = ' + password);

    var retryCount = 0;
    var maxRetry = Math.max(0, prefs.getPref(BASE + 'maxRetry'));
    var delay = Math.max(0, prefs.getPref(BASE + 'delay'));
    timer.setTimeout(function delayedAutoFill() {
      var dialogs = dialogsFor[key];
      dialogsFor[key] = []; // clear already opened dialogs before dispatching, to avoid infinity loop
      dialogs.forEach(function(aRestDialog, aIndex) {
        log(aIndex + ': auto-fill');
        if (args.promptType !== 'promptPassword')
          aRestDialog.ui.loginTextbox.value = username;
        aRestDialog.ui.password1Textbox.value = password;
        aRestDialog.ui.button0.click();
      });
      if (dialogs.length > 0) {
        log('All similar dialogs are processed.');
      }
      else {
        retryCount++;
        if (retryCount <= maxRetry) {
          log('No similar dialog, so retry later. (' + retryCount + ')');
          timer.setTimeout(delayedAutoFill, delay);
        }
      }
    }, delay);

    var index = dialogsFor[key].indexOf(aDialog);
    if (index > -1)
      dialogsFor[key].splice(index, 1);

    return originalOnAccept.call(this, ...aArgs);
  };

  var originalOnCancel = aDialog.onButton1;
  aDialog.onButton1 = function(...aArgs) {
    var index = dialogsFor[key].indexOf(aDialog);
    if (index > -1) {
      log('canceled: ' + args.text + '(' + index + ')');
      dialogsFor[key].splice(index, 1);
    }
    return originalOnCancel.call(this, ...aArgs);
  };
}


var TYPE_BROWSER = 'navigator:browser';
var global = this;
function handleWindow(aWindow)
{
  log('handleWindow');
  var doc = aWindow.document;
  if (doc.documentElement.localName === 'dialog' &&
      doc.documentElement.id === 'commonDialog') {
    log('commonDialog');
    handleCommonDialog(aWindow);
    return;
  } else {
    log('generalWindow');
    if (doc.documentElement.getAttribute('windowtype') === TYPE_BROWSER) {
      startObserveTabModalDialogs(aWindow);
    }
    return;
  }
}

function handleCommonDialog(aWindow, aRootElement)
{
  var doc = aWindow.document;
  var root = aRootElement /* for tabmodaldialog */ ||
               doc.documentElement /* for common dialog */;
  var commonDialog = root.Dialog /* for tabmodaldialog */ ||
                       aWindow.Dialog /* for common dialog */;
  if (!commonDialog) {
    log('missing common dialog');
    return;
  }
  var args = commonDialog.args;
  log('args: ' + JSON.stringify(args));

  switch (args.promptType) {
    case 'promptUserAndPass': 
      if (proxyAuthMatcher.test(args.text)) {
        log('this is a proxy authentication.');
        if (prefs.getPref(BASE + 'proxy'))
          break;
      }
      if (authWithoutRealmMatcher.test(args.text)) {
        log('this is an authentication without realm.');
        if (prefs.getPref(BASE + 'withoutRealm'))
          break;
      }
      if (authWithRealmMatcher.test(args.text)) {
        log('this is an authentication with realm.');
        if (prefs.getPref(BASE + 'withRealm'))
          break;
      }
      return;

    case 'promptPassword': 
      if (passwordMatcher.test(args.text)) {
        log('this is a password prompt.');
        if (prefs.getPref(BASE + 'password'))
          break;
      }
      return;

    default:
      return;
  }

  log('ready to hook an authentication dialog.');
  hookAcceptButton(commonDialog);
}


var tabModalDialogObservers = new WeakMap();

function handleMutationsOnBrowserWindow(aMutations, aObserver) {
  aMutations.forEach(function(aMutation) {
    if (aMutation.type !== 'childList' ||
        !aMutation.addedNodes) {
      return;
    }
    Array.forEach(aMutation.addedNodes, function(aNode) {
      if (aNode.localName !== 'tabmodalprompt') {
        return;
      }
      log('handle new tabmodalprompt');
      var window = aNode.ownerDocument.defaultView;
      window.setTimeout(function() {
        // operate the dialog after successfully initialized
        handleCommonDialog(window, aNode);
      }, 0);
    });
  });
}

function startObserveTabModalDialogs(aWindow) {
  var MutationObserver = aWindow.MutationObserver;
  var observer = new MutationObserver(handleMutationsOnBrowserWindow);
  observer.observe(aWindow.document.documentElement, {
    childList: true,
    subtree:   true
  });
  tabModalDialogObservers.set(aWindow, observer);
  aWindow.addEventListener('unload', function onunload() {
    aWindow.removeEventListener('unload', onunload);
    endObserveTabModalDialogs(aWindow);
  });
}

function endObserveTabModalDialogs(aWindow) {
  var observer = tabModalDialogObservers.get(aWindow);
  if (observer) {
    observer.disconnect();
    tabModalDialogObservers.delete(aWindow);
  }
}

WindowManager.getWindows(null).forEach(handleWindow);
WindowManager.addHandler(handleWindow);

function shutdown()
{
  WindowManager.getWindows(null).forEach(endObserveTabModalDialogs);
  proxyAuthMatcher = undefined;
  dialogsFor = undefined;
  tabModalDialogObservers = undefined;
  WindowManager = undefined;
  global = undefined;
}
