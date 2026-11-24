export type RealEstateLeadInput = {
  transactionType?: "buy" | "rent" | "invest" | "sell" | "unknown" | null;
  propertyType?: "apartment" | "house" | "land" | "commercial" | "other" | "unknown" | null;
  preferredLocation?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetText?: string | null;
  timeframe?: "urgent" | "within_30_days" | "one_to_three_months" | "over_three_months" | "unknown" | null;
  readiness?: "cash_ready" | "pre_approved" | "financing_needed" | "researching" | "unknown" | null;
  email?: string | null;
  phone?: string | null;
};

export type ScoreFactor = { key: string; label: string; points: number; maximum: number; reason: string };
export type LeadScore = { score: number; temperature: "hot" | "warm" | "cold"; factors: ScoreFactor[] };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Deterministic, explainable scoring. Gemini may extract facts, but never chooses the score. */
export function scoreRealEstateLead(lead: RealEstateLeadInput): LeadScore {
  const factors: ScoreFactor[] = [];
  const add = (key: string, label: string, points: number, maximum: number, reason: string) => {
    factors.push({ key, label, points, maximum, reason });
  };

  const intent = lead.transactionType ?? "unknown";
  add("intent", "Transaction intent", intent === "buy" || intent === "invest" ? 20 : intent === "sell" ? 16 : intent === "rent" ? 12 : 0, 20,
    intent === "unknown" ? "No clear transaction intent supplied." : intent === "buy" || intent === "invest" ? "Purchase or investment intent is explicit." : intent === "sell" ? "The enquiry is about selling a property." : "Rental intent is explicit.");

  const timeframe = lead.timeframe ?? "unknown";
  add("timeframe", "Buying timeline", timeframe === "urgent" ? 25 : timeframe === "within_30_days" ? 23 : timeframe === "one_to_three_months" ? 16 : timeframe === "over_three_months" ? 8 : 0, 25,
    timeframe === "urgent" ? "The customer indicates immediate urgency." : timeframe === "within_30_days" ? "The customer plans to act within 30 days." : timeframe === "one_to_three_months" ? "The customer plans to act within one to three months." : timeframe === "over_three_months" ? "The customer has a longer timeline." : "Timeline is not known.");

  const hasBudget = (typeof lead.budgetMin === "number" && lead.budgetMin >= 0) || (typeof lead.budgetMax === "number" && lead.budgetMax > 0) || Boolean(lead.budgetText?.trim());
  const hasBudgetRange = typeof lead.budgetMin === "number" && typeof lead.budgetMax === "number" && lead.budgetMax >= lead.budgetMin;
  add("budget", "Budget clarity", hasBudgetRange ? 15 : hasBudget ? 10 : 0, 15,
    hasBudgetRange ? "A valid budget range is available." : hasBudget ? "The customer gave a budget, but it is not a complete range." : "No usable budget was supplied.");

  const contactPoints = (lead.email?.trim() ? 7 : 0) + (lead.phone?.trim() ? 8 : 0);
  add("contact", "Contact details", contactPoints, 15,
    contactPoints === 15 ? "Email and phone are available." : contactPoints === 8 ? "A phone number is available." : contactPoints === 7 ? "An email address is available." : "No contact method is available.");

  const locationPoints = lead.preferredLocation?.trim() ? 10 : 0;
  add("location", "Location preference", locationPoints, 10, locationPoints ? "A preferred location is specified." : "Preferred location is missing.");

  const propertyType = lead.propertyType ?? "unknown";
  const propertyPoints = ["apartment", "house", "land", "commercial"].includes(propertyType) ? 10 : propertyType === "other" ? 4 : 0;
  add("property", "Property requirements", propertyPoints, 10, propertyPoints ? "A usable property type is specified." : "Property type is not known.");

  const readiness = lead.readiness ?? "unknown";
  const readinessPoints = readiness === "cash_ready" || readiness === "pre_approved" ? 5 : readiness === "financing_needed" ? 3 : readiness === "researching" ? 1 : 0;
  add("readiness", "Financial readiness", readinessPoints, 5,
    readiness === "cash_ready" ? "Customer indicates funds are ready." : readiness === "pre_approved" ? "Customer indicates pre-approval." : readiness === "financing_needed" ? "Customer needs financing support." : readiness === "researching" ? "Customer is still researching." : "Financial readiness is not known.");

  const score = clamp(factors.reduce((sum, factor) => sum + factor.points, 0), 0, 100);
  return { score, temperature: score >= 80 ? "hot" : score >= 50 ? "warm" : "cold", factors };
}

export type PropertyCandidate = {
  id: string;
  title: string;
  property_type: string;
  transaction_type: string;
  location: string;
  price: number;
  currency: string;
  bedrooms: number | null;
  availability_status: string;
  available: boolean;
  last_verified_at: string | null;
};

export type PropertyMatch = { property: PropertyCandidate; score: number; reasons: string[] };

/** Only ranks active, available listings with real stored prices and locations. */
export function matchRealEstateProperties(
  lead: RealEstateLeadInput & { currency?: string | null; bedrooms?: number | null },
  properties: PropertyCandidate[],
  now = Date.now(),
): PropertyMatch[] {
  const location = lead.preferredLocation?.trim().toLowerCase() ?? "";
  const type = lead.propertyType ?? "unknown";
  const intent = lead.transactionType ?? "unknown";
  const budget = typeof lead.budgetMax === "number" && lead.budgetMax > 0 ? lead.budgetMax :
    typeof lead.budgetMin === "number" && lead.budgetMin > 0 ? lead.budgetMin : null;

  return properties.filter((p) => {
    if (!p.available || p.availability_status !== "available" || !Number.isFinite(p.price) || p.price <= 0 || !p.location?.trim()) return false;
    if (!p.last_verified_at || !Number.isFinite(Date.parse(p.last_verified_at))) return false;
    return now - Date.parse(p.last_verified_at) <= 7 * 24 * 60 * 60 * 1000;
  }).map((property) => {
    let score = 0;
    const reasons: string[] = [];
    const propertyType = property.property_type.toLowerCase();
    if (type === "unknown" || type === "other" || propertyType === type) { score += type === "unknown" ? 5 : 30; reasons.push("Property type fits or was not restricted."); }
    if (location && property.location.toLowerCase().includes(location)) { score += 35; reasons.push("Location matches the requested area."); }
    else if (location && location.split(/[,\s]+/).some((part) => part.length > 2 && property.location.toLowerCase().includes(part))) { score += 15; reasons.push("Location is a partial match; agent should verify."); }
    if (budget !== null && property.currency.toUpperCase() === (lead.currency ?? property.currency).toUpperCase()) {
      if (property.price <= budget) { score += 20; reasons.push("Listing price is within the stated budget."); }
      else if (property.price <= budget * 1.1) { score += 8; reasons.push("Listing is up to 10% above budget."); }
    } else if (budget === null) { score += 5; reasons.push("Budget was not supplied; price needs agent review."); }
    if (intent === "unknown" || intent === "buy" || intent === "invest" ? property.transaction_type === "sale" : intent === "rent" ? property.transaction_type === "rent" : true) {
      score += 15; reasons.push("Transaction type is compatible.");
    }
    if (typeof lead.bedrooms === "number" && property.bedrooms === lead.bedrooms) { score += 5; reasons.push("Bedroom count matches."); }
    return { property, score: clamp(score, 0, 100), reasons };
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
}

export function buildFollowupSchedule(createdAt: Date): Array<{ sequence: number; dueAt: string; delayLabel: string }> {
  // Keep five durable queue rows but space them across the 90-day buying cycle.
  const offsets = [
    { sequence: 1, ms: 0, delayLabel: "Immediately" },
    { sequence: 2, ms: 1 * 24 * 60 * 60 * 1000, delayLabel: "1 day" },
    { sequence: 3, ms: 7 * 24 * 60 * 60 * 1000, delayLabel: "7 days" },
    { sequence: 4, ms: 30 * 24 * 60 * 60 * 1000, delayLabel: "30 days" },
    { sequence: 5, ms: 90 * 24 * 60 * 60 * 1000, delayLabel: "90 days" },
  ];
  return offsets.map((item) => ({ sequence: item.sequence, dueAt: new Date(createdAt.getTime() + item.ms).toISOString(), delayLabel: item.delayLabel }));
}
