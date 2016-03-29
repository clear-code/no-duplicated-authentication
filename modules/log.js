var EXPORTED_SYMBOLS = ["log"];

var Cc = Components.classes;
var Ci = Components.interfaces;

var BASE = 'extensions.no-duplicated-authentication@clear-code.com.';

var prefs = Cc['@mozilla.org/preferences;1']
              .getService(Ci.nsIPrefBranch)
              .QueryInterface(Ci.nsIPrefBranch2);

var consoleService = Cc["@mozilla.org/consoleservice;1"]
                       .getService(Ci.nsIConsoleService);

function log(message) {
  try {
    let debugPref = prefs.getBoolPref(BASE + 'debug');
    if (debugPref) {
      consoleService.logStringMessage("auto-confirm: " + message);
    }
  } catch(e) {
  }
}
