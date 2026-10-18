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

    // A report from a starter; a confirmation or a summary needs its form first.
    Faqir.data("newReport", function () {
      return {
        starter: "",
        form: "",
        busy: false,
        create: function () {
          var self = this;
          if (self.busy) return;
          var body = { starter: self.starter };
          if (self.form) body.form = self.form;
          self.busy = true;
          api("POST", "/reports", body).then(function (r) {
            window.location.assign("/app/reports/" + r.id + "/design");
          }, function (err) {
            self.busy = false;
            toast(self, err.message, "error");
          });
        },
      };
    });

    // A report's header actions: publish, and issue a document from its sample.
    Faqir.data("reportActions", function () {
      return {
        reportId: "",
        published: false,
        busy: false,
        publish: function () {
          var self = this;
          self.busy = true;
          api("POST", "/reports/" + self.reportId + "/publish").then(function (v) {
            toast(self, "Published version " + v.version + ".", "success");
            setTimeout(function () { window.location.reload(); }, 600);
          }, function (err) { self.busy = false; toast(self, err.message, "error"); });
        },
        issueSample: function () {
          var self = this;
          self.busy = true;
          api("GET", "/reports/" + self.reportId).then(function (r) {
            return api("POST", "/reports/" + self.reportId + "/documents", { data: r.definition.sample, issue: true });
          }).then(function (d) {
            window.location.assign("/app/documents/" + d.id);
          }, function (err) { self.busy = false; toast(self, err.message, "error"); });
        },
      };
    });

    // A report's settings: numbering and source live in the definition; delete.
    Faqir.data("reportSettings", function () {
      return {
        reportId: "",
        pattern: "",
        manual: false,
        source: "data",
        form: "",
        save: function () {
          var self = this;
          api("GET", "/reports/" + self.reportId).then(function (r) {
            var def = r.definition;
            def.numbering = self.manual ? { manual: true } : { pattern: self.pattern };
            def.source = self.source === "data" ? { kind: "data" } : { kind: self.source, form: self.form };
            return api("PATCH", "/reports/" + self.reportId, { definition: def });
          }).then(function () { toast(self, "Settings saved. Publish to use them for new documents.", "success"); }, function (err) { toast(self, err.message, "error"); });
        },
        remove: function () {
          var self = this;
          if (!window.confirm("Delete this report and every document it issued?")) return;
          api("DELETE", "/reports/" + self.reportId).then(function () { window.location.assign("/app/reports"); }, function (err) { toast(self, err.message, "error"); });
        },
      };
    });

    // A document's page: print the framed sheet, copy or rotate its link, issue a draft, void.
    Faqir.data("documentActions", function () {
      return {
        docId: "",
        link: "",
        reason: "",
        print: function () {
          var frame = document.getElementById("doc-sheet");
          if (frame && frame.contentWindow) frame.contentWindow.print();
        },
        copyLink: function () { copy(this, this.link, "Link copied"); },
        rotate: function () {
          var self = this;
          api("POST", "/documents/" + self.docId + "/share/rotate").then(function () {
            toast(self, "New link made; the old one no longer works.", "success");
            setTimeout(function () { window.location.reload(); }, 700);
          }, function (err) { toast(self, err.message, "error"); });
        },
        issue: function () {
          var self = this;
          api("POST", "/documents/" + self.docId + "/issue", {}).then(function () { window.location.reload(); }, function (err) { toast(self, err.message, "error"); });
        },
        voidIt: function () {
          var self = this;
          api("POST", "/documents/" + self.docId + "/void", { reason: self.reason }).then(function () { window.location.reload(); }, function (err) { toast(self, err.message, "error"); });
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
