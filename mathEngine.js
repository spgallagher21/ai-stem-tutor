import { all, create } from "mathjs";

const math = create(all, { number: "BigNumber", precision: 64, predictable: true });
const ALLOWED_FUNCTIONS = new Set(["abs", "sqrt", "cbrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "log", "log10", "exp", "pow", "min", "max", "round", "floor", "ceil"]);
const FORBIDDEN_NODES = new Set(["AssignmentNode", "FunctionAssignmentNode", "AccessorNode", "IndexNode", "ObjectNode", "ArrayNode", "BlockNode", "ConditionalNode", "RangeNode"]);

function assertSafeNode(node) {
  node.traverse((child) => {
    if (FORBIDDEN_NODES.has(child.type)) throw new Error(`Unsupported calculator operation: ${child.type}.`);
    if (child.type === "FunctionNode" && (!child.fn?.name || !ALLOWED_FUNCTIONS.has(child.fn.name))) {
      throw new Error(`Calculator function "${child.fn?.name || "unknown"}" is not allowed.`);
    }
  });
}

function normalizedPrecision(value) {
  const precision = Number(value);
  return Number.isInteger(precision) && precision >= 0 && precision <= 12 ? precision : 6;
}

export function calculateExpression(request) {
  const expression = String(request?.expression || "").trim();
  if (!expression || expression.length > 500) throw new Error("A calculation must contain a short expression.");
  const node = math.parse(expression);
  assertSafeNode(node);
  const value = node.evaluate();
  const precision = normalizedPrecision(request.precision);
  const formatted = math.format(value, { precision: Math.max(precision, 1), notation: "auto", lowerExp: -9, upperExp: 12 });
  if (/undefined|Infinity|NaN/i.test(formatted)) throw new Error("The calculator produced a non-finite result.");

  let unit = String(request.expected_unit || "").trim();
  let numericValue = null;
  if (value?.isUnit) {
    if (unit) {
      try {
        const converted = value.to(unit);
        numericValue = Number(converted.toNumeric(unit));
        return { ...request, expression, result: math.format(converted, { precision: Math.max(precision, 1) }), numericValue, unit, verified: true };
      } catch {
        throw new Error(`The calculated dimensions do not match the expected unit "${unit}".`);
      }
    }
    unit = value.formatUnits();
  } else {
    numericValue = Number(value?.toNumber ? value.toNumber() : value);
  }
  return { ...request, expression, result: formatted, numericValue, unit, verified: true };
}

export function verifyCalculationRequests(requests = [], { required = false } = {}) {
  const list = Array.isArray(requests) ? requests.slice(0, 12) : [];
  if (required && !list.length) throw new Error("The AI created a numerical problem without providing a calculator expression.");
  return list.map(calculateExpression);
}

export function numericAnswersMatch(studentValue, verifiedCalculation, tolerancePercent = 1) {
  const expected = Number(verifiedCalculation?.numericValue);
  const actual = Number(studentValue);
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) <= scale * Math.max(0, tolerancePercent) / 100;
}

export function extractLastNumericValue(text) {
  const matches = String(text || "").replace(/,/g, "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi);
  return matches?.length ? Number(matches[matches.length - 1]) : null;
}

export function assertQuestionCalculation(question) {
  const calculations = question.verified_calculations || [];
  if (!question.requires_calculation || !calculations.length || question.type !== "multiple_choice") return question;
  const finalCalculation = calculations[calculations.length - 1];
  const matchingOption = (question.options || []).find((option) => numericAnswersMatch(extractLastNumericValue(option), finalCalculation, 1));
  if (!matchingOption) throw new Error("The calculator could not reproduce any answer option in a generated numerical question.");
  if (matchingOption !== question.correct_option) throw new Error("The AI selected an answer option that disagrees with the calculator.");
  return question;
}
