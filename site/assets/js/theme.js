(function () {
  var root = document.documentElement;
  var stored = localStorage.getItem("afdrive-theme");
  if (stored) root.setAttribute("data-theme", stored);

  var btn = document.getElementById("theme-toggle");
  if (!btn) return;

  btn.addEventListener("click", function () {
    var current = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", current);
    localStorage.setItem("afdrive-theme", current);
  });
})();
