const EMAIL_TRIGGER_INTENT = /\b(?:new|incoming|received)\s+(?:gmail\s+)?(?:email|message)s?\b|\bwhen\s+(?:an?\s+)?(?:email|message)\s+(?:arrives?|is\s+received)\b/i;
const SHEETS_WRITE_INTENT = /\b(?:add|append|write|insert|save|log)\b.{0,70}\b(?:to|into|in)\s+(?:the\s+)?(?:google\s+)?sheets?\b|\b(?:qualified\s+)?leads?\s+(?:to|into)\s+(?:the\s+)?(?:google\s+)?sheets?\b/i;

function getUnsupportedRequestedCapabilities(prompt, nodeCatalog) {
  const text = String(prompt || "");
  const providers = new Map((Array.isArray(nodeCatalog) ? nodeCatalog : []).map((node) => [node.id, node]));
  const issues = [];
  const gmail = providers.get("gmail");
  if (EMAIL_TRIGGER_INTENT.test(text) && (!gmail || !Array.isArray(gmail.triggers) || gmail.triggers.length === 0)) {
    issues.push({
      capability: "gmail_new_email_trigger",
      message: "Gmail new-email triggers are not registered yet. Rexnora currently supports Gmail read actions only; it cannot safely start this workflow when a new email arrives.",
    });
  }
  const sheets = providers.get("google_sheets");
  const sheetActions = Array.isArray(sheets?.actions) ? sheets.actions : [];
  const hasSheetsWrite = sheetActions.some((operation) => /append|create|insert|update|write|add_row/i.test(String(operation.id) + " " + String(operation.name)));
  if (SHEETS_WRITE_INTENT.test(text) && /\b(?:google\s+)?sheets?\b/i.test(text) && !hasSheetsWrite) {
    issues.push({
      capability: "google_sheets_write",
      message: "Google Sheets write operations are not registered yet. Rexnora can currently read spreadsheet values and metadata, but it cannot append or save lead rows.",
    });
  }
  return issues;
}

module.exports = { getUnsupportedRequestedCapabilities };
