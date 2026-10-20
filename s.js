// short SMS links: /s/<code> -> the app's public document page
(function () {
  var m = location.pathname.match(/^\/s\/([a-zA-Z0-9]{6,16})\/?$/);
  location.replace(m ? "/#/c/" + m[1] : "/");
})();
