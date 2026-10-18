// forecraft public form: send a form that faqir-validate has passed, without a
// page reload, then show the thank-you state (or follow the redirect).
//
// The form is rendered by @faqir-ui/forms and driven by faqir-core,
// faqir-validate and faqir-rules; this file only does what none of them do —
// post the answers. It listens on the document, so it runs after the form's
// own submit handlers have had their say:
//   • a single-page form: faqir-validate leaves a clean submit un-prevented;
//   • a wizard: faqir-validate's on-valid hook marks the form
//     data-state="submitted" on the last step (and prevents the native submit).
(function () {
  "use strict";

  var config = document.querySelector("[data-form-config]");
  if (!config) return;
  var sending = false;

  // The answers, read the way FormData reads them — except that a control the
  // wizard disabled (another step) still answers, and a field a rule hid does not.
  function pairs(form) {
    var out = [];
    for (var i = 0; i < form.elements.length; i++) {
      var el = form.elements[i];
      if (!el.name || /^(submit|button|reset|file|image)$/.test(el.type)) continue;
      var group = el.closest('[data-ui="field-group"]');
      if (group && group.hidden) continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      if (el.tagName === "SELECT" && el.multiple) {
        for (var j = 0; j < el.selectedOptions.length; j++) out.push([el.name, el.selectedOptions[j].value]);
        continue;
      }
      out.push([el.name, el.value]);
    }
    return out;
  }

  function fail(form, message) {
    if (form.dataset.state === "submitted") delete form.dataset.state;
    form.dispatchEvent(new CustomEvent("fc-failed", { bubbles: true, detail: message }));
  }

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.id !== "fc-form") return;
    var wizard = (form.getAttribute("l-validate") || "").trim() !== "";
    if (wizard) {
      if (form.dataset.state !== "submitted") return; // a step advanced, or a field is invalid
    } else {
      if (e.defaultPrevented) return; // faqir-validate refused it
      e.preventDefault();
    }
    if (sending) return;

    if (config.dataset.preview === "true") {
      form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true }));
      return;
    }

    sending = true;
    fetch(config.dataset.action, {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams(pairs(form)),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (r) {
        sending = false;
        if (!r.ok) {
          var detail = r.body && r.body.errors && r.body.errors.length
            ? r.body.errors.map(function (x) { return x.detail; }).join(" ")
            : (r.body && r.body.detail) || "Something went wrong. Please try again.";
          fail(form, detail);
          return;
        }
        if (config.dataset.redirect) {
          window.location.assign(config.dataset.redirect);
          return;
        }
        form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true }));
        var main = document.getElementById("main");
        if (main) main.scrollIntoView({ block: "start" });
      })
      .catch(function () {
        sending = false;
        fail(form, "We could not reach the server. Check your connection and try again.");
      });
  });
})();
