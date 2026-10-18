// forecraft dashboard behaviour: small faqir-core components that call the same
// /api/v1 an agent calls. Pages declare them with l-data="<name>" and pass
// server data as data-prop-* (JSON), which faqir-core merges into the scope.
(function () {
  "use strict";

  /** fetch /api/v1 with the session cookie; resolves JSON, rejects with the problem's detail. */
  function api(method, path, body) {
    return fetch("/api/v1" + path, {
      method: method,
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (json) {
        if (!res.ok) {
          var detail = json.errors && json.errors.length ? json.errors.map(function (e) { return e.detail; }).join(" ") : json.detail;
          throw new Error(detail || res.statusText);
        }
        return json;
      });
    });
  }
  window.forecraftApi = api;

  function toast(scope, message, tone) {
    var t = scope.$ui("#toasts");
    if (t) t.add({ message: message, tone: tone || "default" });
  }

  function copy(scope, text, what) {
    navigator.clipboard.writeText(text).then(
      function () { toast(scope, (what || "Copied") + " to the clipboard.", "success"); },
      function () { toast(scope, "Copy failed — select the text and copy it by hand.", "error"); },
    );
  }

  function register(Faqir) {
    // The command palette routes a chosen item by its label.
    Faqir.data("palette", function () {
      return {
        routes: {},
        go: function (label) {
          var href = this.routes[String(label).trim()];
          if (href) window.location.assign(href);
        },
      };
    });

    // Any element with a value to copy: <button l-data="copier" data-prop-text='"…"' @click="copy()">
    Faqir.data("copier", function () {
      return { text: "", label: "Copied", copy: function () { copy(this, this.text, this.label); } };
    });

    // New form: create a blank definition through the API, then open the designer.
    Faqir.data("newForm", function () {
      return {
        busy: false,
        create: function () {
          var self = this;
          if (self.busy) return;
          self.busy = true;
          api("POST", "/forms", {
            definition: {
              schema: {
                title: "Untitled form",
                type: "object",
                properties: { name: { type: "string", title: "Your name" }, email: { type: "string", format: "email", title: "Email" } },
                required: ["email"],
              },
            },
          }).then(function (form) {
            window.location.assign("/app/forms/" + form.id + "/design");
          }, function (err) {
            self.busy = false;
            toast(self, err.message, "error");
          });
        },
      };
    });

    // Publish the current draft from any form page.
    Faqir.data("publisher", function () {
      return {
        formId: "",
        busy: false,
        publish: function () {
          var self = this;
          self.busy = true;
          api("POST", "/forms/" + self.formId + "/publish").then(function (v) {
            toast(self, "Published version " + v.version + ".", "success");
            setTimeout(function () { window.location.reload(); }, 600);
          }, function (err) {
            self.busy = false;
            toast(self, err.message, "error");
          });
        },
      };
    });

    // API keys: create (secret shown once), revoke.
    Faqir.data("keysPage", function () {
      return {
        name: "",
        secret: "",
        busy: false,
        revokeId: "",
        revokeName: "",
        create: function () {
          var self = this;
          self.busy = true;
          api("POST", "/keys", { name: self.name || "API key" }).then(function (k) {
            self.busy = false;
            self.secret = k.secret;
          }, function (err) {
            self.busy = false;
            toast(self, err.message, "error");
          });
        },
        copySecret: function () { copy(this, this.secret, "Key copied"); },
        done: function () { window.location.reload(); },
        revoke: function () {
          var self = this;
          api("DELETE", "/keys/" + self.revokeId).then(function () { window.location.reload(); }, function (err) {
            toast(self, err.message, "error");
          });
        },
      };
    });

    // Workspace: rename, invite by email (the link is shown, not mailed).
    Faqir.data("workspacePage", function () {
      return {
        name: "",
        email: "",
        inviteUrl: "",
        rename: function () {
          var self = this;
          api("PATCH", "/workspace", { name: self.name }).then(function () { toast(self, "Workspace renamed.", "success"); }, function (err) {
            toast(self, err.message, "error");
          });
        },
        invite: function () {
          var self = this;
          api("POST", "/workspace/invites", { email: self.email }).then(function (inv) {
            self.inviteUrl = inv.url;
            self.email = "";
          }, function (err) { toast(self, err.message, "error"); });
        },
        copyInvite: function () { copy(this, this.inviteUrl, "Invite link copied"); },
      };
    });

    // One form's settings: open/closed, a submission limit, the slug; delete.
    Faqir.data("formSettings", function () {
      return {
        formId: "",
        open: true,
        limit: "",
        slug: "",
        save: function () {
          var self = this;
          var limit = String(self.limit).trim();
          api("PATCH", "/forms/" + self.formId, {
            status: self.open ? "open" : "closed",
            submission_limit: limit === "" ? null : Number(limit),
            slug: self.slug,
          }).then(function () { toast(self, "Settings saved.", "success"); }, function (err) { toast(self, err.message, "error"); });
        },
        remove: function () {
          var self = this;
          api("DELETE", "/forms/" + self.formId).then(function () { window.location.assign("/app"); }, function (err) {
            toast(self, err.message, "error");
          });
        },
      };
    });

    // Submissions: delete one (the rest of the table is server-rendered).
    Faqir.data("submissionsPage", function () {
      return {
        removeId: "",
        remove: function () {
          var self = this;
          api("DELETE", "/submissions/" + self.removeId).then(function () { window.location.reload(); }, function (err) {
            toast(self, err.message, "error");
          });
        },
      };
    });
  }

  if (window.Faqir) register(window.Faqir);
  else document.addEventListener("faqir:ready", function () { register(window.Faqir); }, { once: true });
})();
