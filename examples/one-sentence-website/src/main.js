// Original template code (MIT). Progressive enhancement only — the site works without JS.
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
  }

  var form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var status = form.querySelector(".form-status");
      var ok = true;
      ["cf-name", "cf-email", "cf-message"].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var valid = el.value.trim().length > 0 && (id !== "cf-email" || /.+@.+\..+/.test(el.value));
        el.classList.toggle("form-error", !valid);
        if (!valid) ok = false;
      });
      if (status) {
        status.textContent = ok
          ? "Thanks! Opening your email app with the message pre-filled."
          : "Please fill in all fields with a valid email.";
      }
      if (ok) {
        var email = document.getElementById("cf-email").value;
        var name = document.getElementById("cf-name").value;
        var msg = document.getElementById("cf-message").value;
        var mail = document.querySelector('a[href^="mailto:"]');
        var to = mail ? mail.getAttribute("href").replace("mailto:", "") : "hello@example.com";
        window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent("Website message from " + name) + "&body=" + encodeURIComponent(msg + "\n\nReply to: " + email);
      }
    });
  }
})();
