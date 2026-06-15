/*
 * Minimal CSInterface loader.
 * Replace this file with Adobe's official CSInterface.js for production packaging.
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (window.__adobe_cep__ && window.__adobe_cep__.evalScript) {
    window.__adobe_cep__.evalScript(script, callback);
    return;
  }
  callback && callback('{"ok":false,"error":"CEP host is not available."}');
};
