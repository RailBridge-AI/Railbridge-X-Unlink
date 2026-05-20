"use client";

const JS_KEYWORDS = new Set([
  "async",
  "await",
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "let",
  "new",
  "return",
  "switch",
  "throw",
  "try",
  "var",
  "while"
]);

const JS_LITERALS = new Set(["true", "false", "null", "undefined"]);
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BASH_COMMANDS = new Set(["curl", "node", "npm", "pnpm", "yarn", "npx"]);
const OPERATOR_CHARS = new Set([
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "&",
  "|",
  "^",
  "?",
  ":",
  ".",
  ",",
  ";",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}"
]);

const TOKEN_CLASS = {
  plain: "text-slate-100",
  keyword: "text-cyan-300",
  literal: "text-violet-300",
  string: "text-emerald-300",
  comment: "text-slate-400 italic",
  number: "text-amber-300",
  operator: "text-slate-300",
  variable: "text-fuchsia-300",
  option: "text-rose-300",
  command: "text-sky-300 font-medium",
  verb: "text-orange-300 font-medium",
  identifier: "text-slate-100"
};

const isWhitespace = (char) => /\s/.test(char);
const isDigit = (char) => char >= "0" && char <= "9";
const isIdentifierStart = (char) => /[A-Za-z_$]/.test(char);
const isIdentifierPart = (char) => /[A-Za-z0-9_$]/.test(char);

const consumeString = (line, start, quote) => {
  let end = start + 1;
  while (end < line.length) {
    const char = line[end];
    if (char === "\\") {
      end += 2;
      continue;
    }
    end += 1;
    if (char === quote) {
      break;
    }
  }
  return line.slice(start, end);
};

const consumeWhile = (line, start, matcher) => {
  let end = start;
  while (end < line.length && matcher(line[end], end)) {
    end += 1;
  }
  return line.slice(start, end);
};

const tokenizeJavaScriptLine = (line) => {
  const tokens = [];
  let index = 0;

  while (index < line.length) {
    const char = line[index];
    const next = line[index + 1];

    if (isWhitespace(char)) {
      const text = consumeWhile(line, index, isWhitespace);
      tokens.push({ type: "plain", text });
      index += text.length;
      continue;
    }

    if (char === "/" && next === "/") {
      tokens.push({ type: "comment", text: line.slice(index) });
      break;
    }

    if (char === "'" || char === "\"" || char === "`") {
      const text = consumeString(line, index, char);
      tokens.push({ type: "string", text });
      index += text.length;
      continue;
    }

    if (isDigit(char)) {
      const text = consumeWhile(line, index, (value) => /[0-9.]/.test(value));
      tokens.push({ type: "number", text });
      index += text.length;
      continue;
    }

    if (isIdentifierStart(char)) {
      const text = consumeWhile(line, index, isIdentifierPart);
      if (JS_KEYWORDS.has(text)) {
        tokens.push({ type: "keyword", text });
      } else if (JS_LITERALS.has(text)) {
        tokens.push({ type: "literal", text });
      } else {
        tokens.push({ type: "identifier", text });
      }
      index += text.length;
      continue;
    }

    if (OPERATOR_CHARS.has(char)) {
      tokens.push({ type: "operator", text: char });
      index += 1;
      continue;
    }

    tokens.push({ type: "plain", text: char });
    index += 1;
  }

  return tokens;
};

const tokenizeBashLine = (line) => {
  const tokens = [];
  let index = 0;
  let sawCommand = false;

  while (index < line.length) {
    const char = line[index];

    if (isWhitespace(char)) {
      const text = consumeWhile(line, index, isWhitespace);
      tokens.push({ type: "plain", text });
      index += text.length;
      continue;
    }

    if (char === "#") {
      tokens.push({ type: "comment", text: line.slice(index) });
      break;
    }

    if (char === "'" || char === "\"") {
      const text = consumeString(line, index, char);
      tokens.push({ type: "string", text });
      index += text.length;
      continue;
    }

    if (char === "$") {
      if (line[index + 1] === "{") {
        const closing = line.indexOf("}", index + 2);
        if (closing > -1) {
          const text = line.slice(index, closing + 1);
          tokens.push({ type: "variable", text });
          index += text.length;
          continue;
        }
      }
      const text = consumeWhile(line, index, (value, position) => {
        if (position === index) {
          return value === "$";
        }
        return /[A-Za-z0-9_]/.test(value);
      });
      tokens.push({ type: "variable", text: text.length > 1 ? text : "$" });
      index += text.length > 1 ? text.length : 1;
      continue;
    }

    if (char === "-" && /[A-Za-z]/.test(line[index + 1] || "")) {
      const text = consumeWhile(line, index, (value) => !isWhitespace(value));
      tokens.push({ type: "option", text });
      index += text.length;
      continue;
    }

    if (isDigit(char)) {
      const text = consumeWhile(line, index, (value) => /[0-9.]/.test(value));
      tokens.push({ type: "number", text });
      index += text.length;
      continue;
    }

    if (isIdentifierStart(char)) {
      const text = consumeWhile(line, index, (value) => /[A-Za-z0-9_./:]/.test(value));
      if (!sawCommand && BASH_COMMANDS.has(text)) {
        tokens.push({ type: "command", text });
      } else if (HTTP_VERBS.has(text)) {
        tokens.push({ type: "verb", text });
      } else {
        tokens.push({ type: "identifier", text });
      }
      sawCommand = true;
      index += text.length;
      continue;
    }

    if (OPERATOR_CHARS.has(char) || char === "\\") {
      tokens.push({ type: "operator", text: char });
      index += 1;
      continue;
    }

    tokens.push({ type: "plain", text: char });
    index += 1;
  }

  return tokens;
};

const tokenizeLine = (line, language) => {
  if (language === "bash" || language === "shell") {
    return tokenizeBashLine(line);
  }
  return tokenizeJavaScriptLine(line);
};

export default function SyntaxCodeBlock({ code, language = "javascript", className = "" }) {
  const normalized = String(code || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  return (
    <pre
      className={`overflow-x-auto rounded border border-slate-200 bg-slate-900 p-3 text-[11px] leading-relaxed ${className}`}
    >
      <code>
        {lines.map((line, lineIndex) => (
          <div key={`line-${lineIndex}`} className="whitespace-pre">
            {tokenizeLine(line, language).map((token, tokenIndex) => (
              <span
                key={`token-${lineIndex}-${tokenIndex}`}
                className={TOKEN_CLASS[token.type] || TOKEN_CLASS.plain}
              >
                {token.text}
              </span>
            ))}
          </div>
        ))}
      </code>
    </pre>
  );
}
