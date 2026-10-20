// forecraft public form: send a form that faqir-validate has passed, without a
// page reload, then show the thank-you state (or follow the redirect).
//
// The form is rendered by @faqir-ui/forms and driven by faqir-core,
// faqir-validate and faqir-rules; this file only posts the answers. Both a
// single-page form and a wizard fire `faqir:valid-submit` with the coerced
// answers in `event.detail` (Faqir.rules.data when rules are loaded).
(function () {
  "use strict";

  var config = document.querySelector("[data-form-config]");
  if (!config) return;
  var sending = false;

  function fail(form, message) {
    if (form.dataset.state === "submitted") delete form.dataset.state;
    form.dispatchEvent(new CustomEvent("fc-failed", { bubbles: true, detail: message }));
  }

  // Honeypot and published-version sit outside the form (form="fc-form") so the
  // page chrome can own them; fold them into the JSON body the API expects.
  function extras(form) {
    var out = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.name === "_fc_hp" || el.name === "_fc_v") out[el.name] = el.value;
    }
    return out;
  }

  document.addEventListener("faqir:valid-submit", function (e) {
    var form = e.target;
    if (!form || form.id !== "fc-form") return;
    e.preventDefault();
    if (sending) return;

    if (config.dataset.preview === "true") {
      form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true }));
      return;
    }

    sending = true;
    var body = Object.assign({}, e.detail || {}, extras(form));
    fetch(config.dataset.action, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ data: body }),
    })
      .then(function (res) {
        return res.json().then(function (payload) { return { ok: res.ok, body: payload }; });
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
        // A form that issues its confirmation links to the PDF on the thank-you state.
        var doc = r.body && r.body.document;
        form.dispatchEvent(new CustomEvent("fc-sent", { bubbles: true, detail: doc && doc.link ? doc.pdf_url : null }));
        var main = document.getElementById("main");
        if (main) main.scrollIntoView({ block: "start" });
      })
      .catch(function () {
        sending = false;
        fail(form, "We could not reach the server. Check your connection and try again.");
      });
  });
})();
