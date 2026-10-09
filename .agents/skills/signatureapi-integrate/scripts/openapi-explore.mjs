#!/usr/bin/env node
// Part of the SignatureAPI signatureapi-integrate skill. Presents compact
// operation, request-check, schema, and webhook views from the published
// OpenAPI spec. It sends no API request. Full workflow: SKILL.md.
const SPEC_URL = process.env.SIGNATUREAPI_SPEC_URL ?? "https://spec.signatureapi.com/openapi.yaml";

/** Every webhook event type declared in the spec's top-level `webhooks`
 * section, optionally filtered by substring, each with the payload schema its
 * POST body declares. */
export function listWebhooks(spec, filter) {
  const out = [];
  for (const [type, item] of Object.entries(spec?.webhooks ?? {})) {
    if (filter && !type.toLowerCase().includes(filter.toLowerCase())) continue;
    const op = item?.post ?? {};
    out.push({
      type,
      summary: op.summary ?? op.description ?? null,
      payload: op.requestBody?.content?.["application/json"]?.schema ?? null,
    });
  }
  return out;
}

export function selectSchema(spec, name) {
  const schemas = spec?.components?.schemas ?? {};
  const hit = Object.keys(schemas).find((k) => k.toLowerCase() === name.toLowerCase());
  return hit ? schemas[hit] : null;
}

function resolveLocalRef(spec, value) {
  if (!value?.$ref?.startsWith("#/")) return value;
  return value.$ref
    .slice(2)
    .split("/")
    .reduce((node, part) => node?.[part.replaceAll("~1", "/").replaceAll("~0", "~")], spec);
}

function parameterCard(spec, value) {
  const parameter = resolveLocalRef(spec, value) ?? {};
  const schema = resolveLocalRef(spec, parameter.schema) ?? {};
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required ?? false,
    description: parameter.description ?? null,
    type: schema.type ?? null,
    format: schema.format ?? null,
    default: schema.default ?? null,
    enum: schema.enum ?? null,
    minimum: schema.minimum ?? null,
    maximum: schema.maximum ?? null,
  };
}

/** Compact method-aware cards for every operation matching a name, path, summary, or description. */
export function listOperations(spec, filter) {
  const needle = filter?.toLowerCase();
  const operations = [];
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!/^(get|post|put|patch|delete)$/i.test(method) || !operation?.operationId) continue;
      const card = {
        name: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.operationId,
        description: operation.description ?? null,
      };
      const searchable = Object.values(card).filter(Boolean).join(" ").toLowerCase();
      if (!needle || searchable.includes(needle)) operations.push(card);
    }
  }
  return operations;
}

/** Inspect one exact method/path pair. Absence includes nearby operations instead of implying a capability. */
export function inspectOperation(spec, method, path) {
  const normalizedMethod = method?.toUpperCase();
  const operation = spec?.paths?.[path]?.[method?.toLowerCase()];
  if (!operation?.operationId) {
    const relatedTerm = path
      ?.split("/")
      .filter((part) => part && !part.startsWith("{"))
      .at(-1);
    return {
      found: false,
      requested: `${normalizedMethod} ${path}`,
      related: listOperations(spec, relatedTerm ?? path),
    };
  }
  const pathParameters = spec.paths[path].parameters ?? [];
  const operationParameters = operation.parameters ?? [];
  return {
    found: true,
    operation: {
      name: operation.operationId,
      method: normalizedMethod,
      path,
      summary: operation.summary ?? operation.operationId,
      description: operation.description ?? null,
      parameters: [...pathParameters, ...operationParameters].map((parameter) => parameterCard(spec, parameter)),
      request_body: operation.requestBody?.content?.["application/json"]?.schema ?? null,
      responses: Object.keys(operation.responses ?? {}),
    },
  };
}

function operationLine(operation) {
  return `- \`${operation.method} ${operation.path}\` — ${operation.summary}`;
}

/** Agent-readable exact-operation result. This describes a local inspection, never an API response. */
export function renderOperationMarkdown(result) {
  if (!result.found) {
    const related = result.related.length
      ? `\n## Related operations\n\n${result.related.map(operationLine).join("\n")}\n`
      : "";
    return `# Local contract inspection: operation not found\n\nNo API request was sent.\n\n\`${result.requested}\` is not defined by the public OpenAPI contract.\n${related}\nDo not send this request or guess another path.`;
  }
  const { operation } = result;
  const parameters = operation.parameters.length
    ? [
        "## Parameters",
        "",
        "| Name | Location | Required | Contract |",
        "| --- | --- | --- | --- |",
        ...operation.parameters.map((parameter) => {
          const constraints = [parameter.type, parameter.format, parameter.minimum !== null && `minimum ${parameter.minimum}`, parameter.maximum !== null && `maximum ${parameter.maximum}`, parameter.enum && `one of ${parameter.enum.join(", ")}`].filter(Boolean).join(", ");
          return `| \`${parameter.name}\` | ${parameter.in} | ${parameter.required ? "yes" : "no"} | ${constraints || "not specified"} |`;
        }),
        "",
      ].join("\n")
    : "";
  return `# Local contract inspection: ${operation.name}\n\nNo API request was sent.\n\n\`${operation.method} ${operation.path}\`\n\n${operation.summary}\n\n${parameters}## Responses\n\n${operation.responses.map((status) => `- \`${status}\``).join("\n")}`;
}

function pathMatches(template, concrete) {
  const expected = template.split("/").filter(Boolean);
  const actual = concrete.split("/").filter(Boolean);
  return expected.length === actual.length && expected.every((part, index) => /^\{[^}]+\}$/.test(part) || part === actual[index]);
}

function candidatePaths(pathname) {
  const candidates = [pathname];
  if (pathname.startsWith("/v1/")) candidates.push(pathname.slice(3));
  return candidates;
}

function parseTarget(target) {
  const url = new URL(target, "https://contract.invalid");
  return { pathname: url.pathname, query: url.searchParams };
}

function parameterProblem(parameter, raw) {
  let value = raw;
  if (parameter.type === "integer" || parameter.type === "number") {
    value = Number(raw);
    if (!Number.isFinite(value) || (parameter.type === "integer" && !Number.isInteger(value))) {
      return `\`${parameter.name}\` must be ${parameter.type}; received \`${raw}\`.`;
    }
  } else if (parameter.type === "boolean" && raw !== "true" && raw !== "false") {
    return `\`${parameter.name}\` must be boolean; received \`${raw}\`.`;
  }
  if (parameter.enum && !parameter.enum.map(String).includes(String(value))) {
    return `\`${parameter.name}\` must be one of ${parameter.enum.join(", ")}; received \`${raw}\`.`;
  }
  if (parameter.minimum !== null && value < parameter.minimum) {
    return `\`${parameter.name}\` is ${raw}; its minimum is ${parameter.minimum}.`;
  }
  if (parameter.maximum !== null && value > parameter.maximum) {
    return `\`${parameter.name}\` is ${raw}; its maximum is ${parameter.maximum}.`;
  }
  return null;
}

/** Validate method, concrete path and query values locally against the OpenAPI contract. */
export function checkRequest(spec, method, target) {
  const normalizedMethod = method?.toUpperCase();
  let parsed;
  try {
    parsed = parseTarget(target);
  } catch {
    return {
      ok: false,
      request_sent: false,
      requested: `${normalizedMethod} ${target}`,
      operation: null,
      related: [],
      problems: [{ parameter: null, message: `\`${target}\` is not a valid URL or path.` }],
    };
  }
  const templates = Object.keys(spec?.paths ?? {}).filter((template) =>
    candidatePaths(parsed.pathname).some((candidate) => pathMatches(template, candidate)),
  );
  const template = templates.find((candidate) => spec.paths[candidate]?.[method?.toLowerCase()]);
  if (!template) {
    const related = templates.flatMap((candidate) =>
      listOperations(spec).filter((operation) => operation.path === candidate),
    );
    const fallbackTerm = parsed.pathname.split("/").filter(Boolean).at(-1);
    return {
      ok: false,
      request_sent: false,
      requested: `${normalizedMethod} ${parsed.pathname}`,
      operation: null,
      related: related.length ? related : listOperations(spec, fallbackTerm),
      problems: [
        {
          parameter: null,
          message: `\`${normalizedMethod} ${parsed.pathname}\` does not match a public API operation.`,
        },
      ],
    };
  }
  const operation = inspectOperation(spec, normalizedMethod, template).operation;
  const queryParameters = operation.parameters.filter((parameter) => parameter.in === "query");
  const known = new Set(queryParameters.map((parameter) => parameter.name));
  const problems = [];
  for (const name of new Set(parsed.query.keys())) {
    if (!known.has(name)) {
      problems.push({ parameter: name, message: `\`${name}\` is not a query parameter for this operation.` });
    }
  }
  for (const parameter of queryParameters) {
    const values = parsed.query.getAll(parameter.name);
    if (parameter.required && values.length === 0) {
      problems.push({ parameter: parameter.name, message: `\`${parameter.name}\` is a required query parameter.` });
      continue;
    }
    for (const value of values) {
      const message = parameterProblem(parameter, value);
      if (message) problems.push({ parameter: parameter.name, message });
    }
  }
  return {
    ok: problems.length === 0,
    request_sent: false,
    requested: `${normalizedMethod} ${parsed.pathname}${parsed.query.size ? `?${parsed.query}` : ""}`,
    operation,
    related: [],
    problems,
  };
}

/** Agent-readable request verdict. This checks the contract locally and never calls the API. */
export function renderRequestCheckMarkdown(result) {
  const heading = result.ok ? "# Local request check passed" : "# Local request check failed";
  const matched = result.operation
    ? `\nMatched operation: \`${result.operation.method} ${result.operation.path}\` (${result.operation.name}).\n`
    : "";
  const problems = result.problems.length
    ? `\n## Problems\n\n${result.problems.map((problem) => `- ${problem.message}`).join("\n")}\n`
    : "";
  return `${heading}\n\nNo API request was sent.\n${matched}${problems}`.trim();
}

export function renderOperationsMarkdown(operations, filter) {
  const title = filter ? `# Operations matching “${filter}”` : "# Public API operations";
  const notice = "No SignatureAPI operation was called; this view reads the OpenAPI contract.";
  if (operations.length === 0) return `${title}\n\n${notice}\n\nNo matching operations were found.`;
  const rows = operations.map(
    (operation) => `| ${operation.name} | \`${operation.method} ${operation.path}\` | ${operation.summary} |`,
  );
  return `${title}\n\n${notice}\n\n| Name | Operation | Purpose |\n| --- | --- | --- |\n${rows.join("\n")}\n\n${operations.length} operation${operations.length === 1 ? "" : "s"} found.`;
}

async function loadSpec() {
  const { parse } = await import("yaml");
  const res = await fetch(SPEC_URL);
  if (!res.ok) {
    throw new Error(`Could not fetch the OpenAPI document (HTTP ${res.status}).`);
  }
  return parse(await res.text());
}

function printResult(data, markdown, json, failed = false) {
  console.log(json ? JSON.stringify(data, null, 2) : markdown);
  if (failed) process.exitCode = 1;
}

async function main(argv) {
  const json = argv.includes("--json");
  const clean = argv.filter((arg) => arg !== "--json");
  const [mode, ...args] = clean;
  const usage = [
    "openapi-explore.mjs operations [filter]",
    "openapi-explore.mjs operation <method> <path>",
    "openapi-explore.mjs check-request <method> <url-or-path>",
    "openapi-explore.mjs schema <name>",
    "openapi-explore.mjs webhooks [filter]",
  ];
  if (!mode || mode === "--help") {
    printResult({ ok: true, usage }, `# OpenAPI explorer\n\n${usage.map((line) => `- \`${line}\``).join("\n")}`, json);
    return;
  }
  const spec = await loadSpec();
  if (mode === "paths" || mode === "operations") {
    const operations = listOperations(spec, args[0]);
    printResult({ ok: true, count: operations.length, operations }, renderOperationsMarkdown(operations, args[0]), json);
    return;
  }
  if (mode === "path" || mode === "operation") {
    const result = inspectOperation(spec, args[0], args[1]);
    printResult({ ok: result.found, ...result }, renderOperationMarkdown(result), json, !result.found);
    return;
  }
  if (mode === "check-request") {
    const result = checkRequest(spec, args[0], args[1]);
    printResult(result, renderRequestCheckMarkdown(result), json, !result.ok);
    return;
  }
  if (mode === "schema") {
    const schema = selectSchema(spec, args[0] ?? "");
    const found = Boolean(schema);
    const data = { ok: found, name: args[0], required: schema?.required ?? [], properties: Object.keys(schema?.properties ?? {}), schema };
    const markdown = found
      ? `# Schema: ${args[0]}\n\nNo SignatureAPI operation was called; this view reads the OpenAPI contract.\n\n## Required\n\n${data.required.length ? data.required.map((name) => `- \`${name}\``).join("\n") : "None."}\n\n## Properties\n\n${data.properties.length ? data.properties.map((name) => `- \`${name}\``).join("\n") : "None."}\n\n## Contract fragment\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
      : `# Local contract inspection: schema not found\n\nNo API request was sent.\n\nNo schema named \`${args[0]}\` is defined.`;
    printResult(data, markdown, json, !found);
    return;
  }
  if (mode === "webhooks") {
    const events = listWebhooks(spec, args[0]);
    const markdown = events.length
      ? `# Webhook events${args[0] ? ` matching “${args[0]}”` : ""}\n\nNo SignatureAPI operation was called; this view reads the OpenAPI contract.\n\n${events.map((event) => `- \`${event.type}\` — ${event.summary ?? "No summary."}`).join("\n")}`
      : `# Local contract inspection: webhook not found\n\nNo API request was sent.\n\nNo webhook event matches \`${args[0] ?? ""}\`.`;
    printResult({ ok: events.length > 0, count: events.length, events }, markdown, json, events.length === 0);
    return;
  }
  printResult(
    { ok: false, message: `Unknown command: ${mode}`, usage },
    `# Local OpenAPI explorer error\n\nUnknown command: \`${mode}\`.\n\n${usage.map((line) => `- \`${line}\``).join("\n")}`,
    json,
    true,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`# Local OpenAPI explorer error\n\nNo API request was sent.\n\n${error.message}`);
    process.exitCode = 1;
  });
}
