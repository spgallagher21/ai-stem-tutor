const EMPTY_USAGE = {
  apiRequests: 0,
  providerAttempts: 0,
  standardRequests: 0,
  searchRequests: 0,
  repairRequests: 0,
  visionRequests: 0,
  failedRequests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function mergeAiUsage(current = {}, event = {}) {
  const next = { ...EMPTY_USAGE, ...current };
  next.apiRequests += finite(event.apiRequests);
  next.providerAttempts += finite(event.providerAttempts);
  next.standardRequests += finite(event.standardRequests);
  next.searchRequests += finite(event.searchRequests);
  next.repairRequests += finite(event.repairRequests);
  next.visionRequests += finite(event.visionRequests);
  next.failedRequests += finite(event.failedRequests);
  next.inputTokens += finite(event.inputTokens);
  next.outputTokens += finite(event.outputTokens);
  next.totalTokens += finite(event.totalTokens);
  return next;
}

export function describeAiFailure(data = {}, status = 0) {
  const rawMessage = String(data.error || `Request failed (status ${status}).`);
  const retrySeconds = finite(data.retryAfterSeconds) || null;
  const metric = String(data.quotaMetric || data.quotaReason || "");
  const model = data.model ? ` (${data.model})` : "";
  const isSearch = data.requestKind === "search";
  const isDaily = /per.?day|daily|rpd/i.test(`${metric} ${rawMessage}`) || retrySeconds > 120;
  const isToken = /token|tpm/i.test(`${metric} ${rawMessage}`);
  const isRequestRate = /request|rpm|rate/i.test(`${metric} ${rawMessage}`);

  if (data.errorSource === "app_rate_limit") {
    return {
      message: `StudyLoop is handling too many AI requests at once. Wait about ${retrySeconds || 60}s, then try again.`,
      cooldownSeconds: retrySeconds || 60,
      retryable: true,
    };
  }
  if (status !== 429 && !/quota|rate.?limit|resource_exhausted/i.test(rawMessage)) {
    return { message: rawMessage, cooldownSeconds: null, retryable: status >= 500 };
  }
  if (isSearch && isDaily) {
    return {
      message: `This Google Search allowance has been used for today${model}. Core notes and questions still work; try web-assisted tutoring after the project quota resets.`,
      cooldownSeconds: null,
      retryable: false,
    };
  }
  if (isSearch) {
    return {
      message: retrySeconds
        ? `Google Search grounding is temporarily rate-limited${model}. Try again in about ${retrySeconds}s; core notes and questions are unaffected.`
        : `Google Search grounding is unavailable for this project right now${model}. Core notes and questions are unaffected; check the project's active limits in Google AI Studio.`,
      cooldownSeconds: retrySeconds,
      retryable: Boolean(retrySeconds),
    };
  }
  if (isDaily) {
    return {
      message: `This Gemini project's daily allowance has been reached${model}. It will not be fixed by repeatedly retrying; check the active limits in Google AI Studio.`,
      cooldownSeconds: null,
      retryable: false,
    };
  }
  if (isToken) {
    return {
      message: `Gemini's input-token limit is temporarily exhausted${model}. Large PDF operations are the usual cause${retrySeconds ? `; try again in about ${retrySeconds}s` : ""}.`,
      cooldownSeconds: retrySeconds,
      retryable: Boolean(retrySeconds),
    };
  }
  if (isRequestRate || retrySeconds) {
    return {
      message: `Gemini's request-rate limit was reached${model}${retrySeconds ? `. Try again in about ${retrySeconds}s` : "; try again shortly"}.`,
      cooldownSeconds: retrySeconds,
      retryable: true,
    };
  }
  return {
    message: `Gemini refused this request because of a project quota${model}. Check the project's active RPM, TPM and daily limits in Google AI Studio.`,
    cooldownSeconds: null,
    retryable: false,
  };
}
