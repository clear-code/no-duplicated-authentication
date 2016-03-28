/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

var BASE = 'extensions.no-duplicated-proxy-authentication@clear-code.com.';
var prefs = require('lib/prefs').prefs;
{
  if (prefs.getDefaultPref(BASE + 'debug') === null)
    prefs.setDefaultPref(BASE + 'debug', false);

  prefs.setDefaultPref(BASE + 'proxy',        true);
  prefs.setDefaultPref(BASE + 'password',     false);
  prefs.setDefaultPref(BASE + 'withoutRealm', false);
  prefs.setDefaultPref(BASE + 'withRealm',    false);
}

var log = require('log').log;

load('lib/WindowManager');

function toMatcher(aPatternString) {
  var expression = aPatternString.replace(/([\.\*\+\(\)\{\}\[\]])/g, '\\\1');
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
})();

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
    var password = aRestDialog.ui.password1Textbox.value;

    log("authenticated: " + args.text + ", username = " + username + ", password = " + password);

    var dialogs = dialogsFor[key];
    dialogsFor[key] = []; // clear already opened dialogs before dispatching, to avoid infinity loop
    dialogs.forEach(function(aRestDialog, aIndex) {
      if (aRestDialog === aDialog) {
        log(aIndex + ": skipped (original)");
        return;
      }

      log(aIndex + ": auto-fill");
      if (args.promptType !== 'promptPassword')
        aRestDialog.ui.loginTextbox.value = username;
      aRestDialog.ui.password1Textbox.value = password;
      aRestDialog.ui.button0.click();
    });

    log("All known dialogs are processed.");
    return originalOnAccept.call(this, ...aArgs);
  };

  var originalOnCancel = aDialog.onButton1;
  aDialog.onButton1 = function(...aArgs) {
    var index = dialogsFor[key].indexOf(aDialog);
    if (index > -1) {
      log("canceled: " + args.text + "(" + index + ")");
      dialogsFor[key].splice(index, 1);
    }
    return originalOnCancel.call(this, ...aArgs);
  };
}


var TYPE_BROWSER = "navigator:browser";
var global = this;
function handleWindow(aWindow)
{
  log("handleWindow");
  var doc = aWindow.document;
  if (doc.documentElement.localName === 'dialog' &&
      doc.documentElement.id === 'commonDialog') {
    log("commonDialog");
    handleCommonDialog(aWindow);
    return;
  } else {
    log("generalWindow");
    if (doc.documentElement.getAttribute("windowtype") === TYPE_BROWSER) {
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
    log("missing common dialog");
    return;
  }
  var args = commonDialog.args;
  log("args: " + JSON.stringify(args));

  switch (args.promptType) {
    case 'promptUserAndPass': 
      if (proxyAuthMatcher.test(args.text)) {
        log("this is a proxy authentication.");
        if (prefs.getPref(BASE + 'proxy'))
          break;
      }
      if (authWithoutRealmMatcher.test(args.text)) {
        log("this is an authentication without realm.");
        if (prefs.getPref(BASE + 'withoutRealm'))
          break;
      }
      if (authWithRealmMatcher.test(args.text)) {
        log("this is an authentication with realm.");
        if (prefs.getPref(BASE + 'withRealm'))
          break;
      }
      return;

    case 'promptPassword': 
      if (passwordMatcher.test(args.text)) {
        log("this is a password prompt.");
        if (prefs.getPref(BASE + 'password'))
          break;
      }
      return;

    default:
      return;
  }

  log("ready to hook an authentication dialog.");
  hookAcceptButton(commonDialog);
}


var tabModalDialogObservers = new WeakMap();

function handleMutationsOnBrowserWindow(aMutations, aObserver) {
  aMutations.forEach(function(aMutation) {
    if (aMutation.type !== "childList" ||
        !aMutation.addedNodes) {
      return;
    }
    Array.forEach(aMutation.addedNodes, function(aNode) {
      if (aNode.localName !== "tabmodalprompt") {
        return;
      }
      log("handle new tabmodalprompt");
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
  aWindow.addEventListener("unload", function onunload() {
    aWindow.removeEventListener("unload", onunload);
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
  prefs.removePrefListener(listener);
  WindowManager = undefined;
  global = undefined;
}
