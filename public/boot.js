// Start faqir-core after every deferred script on the page has run.
//
// The core script carries data-manual: its own auto-start can fire between two
// deferred scripts (a setTimeout once the document is interactive), booting
// before faqir-rules.js or a page's Faqir.data() registrations have arrived,
// and then l-rules is silently never bound (FAQIR-UPSTREAM.md #28). Deferred
// scripts run in document order, and this one is last.
window.Faqir.start();
