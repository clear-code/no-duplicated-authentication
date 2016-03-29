var EXPORTED_SYMBOLS = ['log'];

var Cc = Components.classes;
var Ci = Components.interfaces;

var BASE = 'extensions.no-duplicated-authentication@clear-code.com.';

var prefs = Cc['@mozilla.org/preferences;1']
              .getService(Ci.nsIPrefBranch)
              .QueryInterface(Ci.nsIPrefBranch2);

var { console } = Components.utils.import('resource://gre/modules/Console.jsm', {});

function log(aMessage, ...aArgs) {
  try {
    let debugPref = prefs.getBoolPref(BASE + 'debug');
    if (debugPref) {
      console.log('no-duplicated-authentication: ' + aMessage, aArgs);
    }
  } catch(e) {
  }
}
