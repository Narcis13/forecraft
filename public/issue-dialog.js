// forecraft issue dialog — one way to issue a document, wherever the button is
// (the report's page, the report designer). It reads the published version's
// source and asks for what that source needs: a period for a summary or a
// register, a submission for one-per-submission, the data otherwise. Then a
// draft (prints DRAFT, can be issued later) or a numbered, final document.
(function () {
  "use strict";

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

  /** YYYY-MM-DD of a local date. */
  function iso(d) {
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  var PRESETS = [
    { id: "7", label: "Last 7 days", range: function () { return [iso(daysAgo(6)), iso(new Date())]; } },
    { id: "30", label: "Last 30 days", range: function () { return [iso(daysAgo(29)), iso(new Date())]; } },
    { id: "month", label: "This month", range: function () { var d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; } },
    { id: "all", label: "All time", range: function () { return ["", ""]; } },
  ];

  /** A submission as one line: when it came in and its first two short answers. */
  function describe(sub) {
    var when = new Date(sub.created_at);
    var answers = Object.keys(sub.data || {}).map(function (k) { return sub.data[k]; })
      .filter(function (v) { return (typeof v === "string" && v.trim()) || typeof v === "number"; })
      .slice(0, 2).map(function (v) { v = String(v); return v.length > 32 ? v.slice(0, 31) + "…" : v; });
    var date = isNaN(when) ? sub.created_at : when.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    return [date].concat(answers).join(" · ");
  }

  function register(Faqir) {
    Faqir.data("issueDialog", function () {
      return {
        reportId: "",
        newTab: false,
        loading: false,
        ready: false,
        busy: false,
        error: "",
        intro: "",
        kind: "",
        formId: "",
        presets: PRESETS.map(function (p) { return { id: p.id, label: p.label }; }),
        preset: "30",
        since: "",
        until: "",
        countText: "",
        submissions: [],
        submission: "",
        dataText: "",
        countSeq: 0,

        /** Read the published version: its source decides what the dialog asks. */
        load: function () {
          var self = this;
          self.loading = true;
          self.ready = false;
          self.error = "";
          self.kind = "";
          self.intro = "";
          var report;
          api("GET", "/reports/" + self.reportId).then(function (r) {
            report = r;
            if (r.published_version === null) throw new Error("Publish the report first: documents come from a published version.");
            return api("GET", "/reports/" + self.reportId + "/versions/" + r.published_version);
          }).then(function (v) {
            var def = v.definition;
            var source = def.source || { kind: "data" };
            self.formId = source.form || "";
            var later = report.has_unpublished_changes ? " Changes you have not published yet are not in it." : "";
            var from = "From version " + v.version + "." + later;
            if (source.kind === "data") {
              self.dataText = JSON.stringify(def.sample || {}, null, 2);
              self.intro = "The document prints the data below. " + from;
              return source.kind;
            }
            return api("GET", "/forms/" + source.form).then(function (form) {
              var title = form.definition.schema.title;
              if (source.kind === "submission") {
                self.intro = "One document for one submission of " + title + ". " + from;
                return api("GET", "/forms/" + source.form + "/submissions?limit=50").then(function (list) {
                  self.submissions = list.items.map(function (s) { return { id: s.id, label: describe(s) }; });
                  self.submission = self.submissions.length ? self.submissions[0].id : "";
                  return source.kind;
                });
              }
              self.intro = (source.kind === "summary" ? "A summary of the submissions of " : "A register of the submissions of ") + title + " in a period. " + from;
              self.usePreset(self.preset);
              return source.kind;
            });
          }).then(function (kind) {
            self.kind = kind;
            self.loading = false;
            self.ready = kind !== "submission" || Boolean(self.submission);
          }, function (err) {
            self.loading = false;
            self.error = err.message;
          });
        },
        usePreset: function (id) {
          var p = PRESETS.find(function (x) { return x.id === id; });
          if (!p) return;
          var r = p.range();
          this.preset = id;
          this.since = r[0];
          this.until = r[1];
          this.count();
        },
        setPeriod: function (which, value) {
          this[which] = value;
          this.preset = "";
          this.count();
        },
        /** How many submissions the period holds, so an empty summary is no surprise. */
        count: function () {
          var self = this;
          if (!self.formId) return;
          var seq = ++self.countSeq;
          var q = "?limit=1" + (self.since ? "&since=" + self.since + "T00:00:00.000Z" : "") + (self.until ? "&until=" + self.until + "T23:59:59.999Z" : "");
          self.countText = "";
          api("GET", "/forms/" + self.formId + "/submissions" + q).then(function (r) {
            if (seq !== self.countSeq) return;
            self.countText = r.total === 0 ? "No submissions in this period." : r.total + " submission" + (r.total === 1 ? "" : "s") + " in this period.";
          }, function () {});
        },
        /** POST …/documents: issue (numbered, final) or keep as a draft; then open it. */
        create: function (issue) {
          var self = this;
          var body = { issue: issue };
          self.error = "";
          if (self.kind === "summary" || self.kind === "submissions") {
            if (self.since && self.until && self.since > self.until) { self.error = "The period ends before it starts."; return; }
            if (self.since || self.until) {
              body.period = {};
              if (self.since) body.period.since = self.since;
              if (self.until) body.period.until = self.until;
            }
          } else if (self.kind === "submission") {
            body.submission = self.submission;
          } else {
            try {
              body.data = JSON.parse(self.dataText);
            } catch (err) {
              self.error = "The data is not valid JSON yet: " + err.message;
              return;
            }
          }
          self.busy = true;
          api("POST", "/reports/" + self.reportId + "/documents", body).then(function (doc) {
            self.busy = false;
            var url = "/app/documents/" + doc.id;
            var dialog = self.$ui("#issue-document");
            if (dialog) dialog.close();
            // From the designer the document opens beside it; a blocked pop-up opens it here.
            var tab = self.newTab ? window.open(url, "_blank") : null;
            if (tab) tab.opener = null;
            else window.location.assign(url);
          }, function (err) {
            self.busy = false;
            self.error = err.message;
          });
        },
      };
    });
  }

  if (window.Faqir) register(window.Faqir);
  else document.addEventListener("faqir:ready", function () { register(window.Faqir); }, { once: true });
})();
