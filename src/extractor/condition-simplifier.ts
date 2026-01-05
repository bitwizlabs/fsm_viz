/**
 * Condition simplification utilities.
 *
 * Note: Full boolean simplification is out of scope for v1.
 * We provide basic simplifications to make conditions more readable.
 */

/**
 * Simplify a boolean condition string.
 */
export function simplifyCondition(condition: string): string {
  let result = condition;

  // Normalize whitespace
  result = result.replace(/\s+/g, ' ').trim();

  // Remove outer parentheses if they wrap the entire expression
  result = removeOuterParens(result);

  // Simplify common patterns
  result = simplifyPatterns(result);

  // Remove redundant negations
  result = simplifyNegations(result);

  return result;
}

/**
 * Remove outer parentheses if they wrap the entire expression.
 */
function removeOuterParens(expr: string): string {
  if (!expr.startsWith('(') || !expr.endsWith(')')) {
    return expr;
  }

  // Check if the parens are balanced throughout
  let depth = 0;
  let allBalanced = true;

  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;

    if (depth === 0) {
      allBalanced = false;
      break;
    }
  }

  if (allBalanced && depth === 1) {
    return expr.slice(1, -1).trim();
  }

  return expr;
}

/**
 * Simplify common patterns.
 */
function simplifyPatterns(expr: string): string {
  let result = expr;

  // x == 1'b1 → x
  result = result.replace(/(\w+)\s*==\s*1'b1/g, '$1');

  // x == 1'b0 → !x
  result = result.replace(/(\w+)\s*==\s*1'b0/g, '!$1');

  // x === 1'b1 → x (4-state comparison)
  result = result.replace(/(\w+)\s*===\s*1'b1/g, '$1');

  // x === 1'b0 → !x
  result = result.replace(/(\w+)\s*===\s*1'b0/g, '!$1');

  // x != 1'b0 → x
  result = result.replace(/(\w+)\s*!=\s*1'b0/g, '$1');

  // x != 1'b1 → !x
  result = result.replace(/(\w+)\s*!=\s*1'b1/g, '!$1');

  // (x) where x is a simple identifier → x
  result = result.replace(/\((\w+)\)/g, '$1');

  return result;
}

/**
 * Simplify negations.
 */
function simplifyNegations(expr: string): string {
  let result = expr;

  // !!x → x
  result = result.replace(/!!\s*(\w+)/g, '$1');

  // !(!x) → x
  result = result.replace(/!\s*\(\s*!\s*(\w+)\s*\)/g, '$1');

  // !(x == y) → x != y
  result = result.replace(/!\s*\(\s*(\w+)\s*==\s*(\w+)\s*\)/g, '$1 != $2');

  // !(x != y) → x == y
  result = result.replace(/!\s*\(\s*(\w+)\s*!=\s*(\w+)\s*\)/g, '$1 == $2');

  return result;
}

/**
 * Format condition for display.
 */
export function formatCondition(condition: string): string {
  const simplified = simplifyCondition(condition);

  // If the condition is very long, we might want to truncate
  if (simplified.length > 50) {
    return simplified.slice(0, 47) + '...';
  }

  return simplified;
}

/**
 * Negate a condition.
 */
export function negateCondition(condition: string): string {
  const simplified = simplifyCondition(condition);

  // Simple identifier
  if (/^\w+$/.test(simplified)) {
    return `!${simplified}`;
  }

  // Already negated
  if (simplified.startsWith('!') && /^!\w+$/.test(simplified)) {
    return simplified.slice(1);
  }

  // Complex expression
  return `!(${simplified})`;
}

/**
 * Combine conditions with AND.
 */
export function andConditions(conditions: string[]): string {
  if (conditions.length === 0) return '';
  if (conditions.length === 1) return conditions[0];

  const parts = conditions.map((c) => {
    const simplified = simplifyCondition(c);
    // Wrap in parens if it contains OR
    if (simplified.includes('||') || simplified.includes(' or ')) {
      return `(${simplified})`;
    }
    return simplified;
  });

  return parts.join(' && ');
}

/**
 * Combine conditions with OR.
 */
export function orConditions(conditions: string[]): string {
  if (conditions.length === 0) return '';
  if (conditions.length === 1) return conditions[0];

  const parts = conditions.map((c) => simplifyCondition(c));
  return parts.join(' || ');
}

/**
 * Check if two conditions are equivalent (basic check).
 */
export function conditionsEquivalent(cond1: string, cond2: string): boolean {
  const s1 = simplifyCondition(cond1).toLowerCase();
  const s2 = simplifyCondition(cond2).toLowerCase();
  return s1 === s2;
}

/**
 * Extract variables mentioned in a condition.
 */
export function extractConditionVariables(condition: string): string[] {
  const variables: string[] = [];
  const matches = condition.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);

  if (matches) {
    for (const match of matches) {
      // Skip Verilog keywords
      const keywords = ['and', 'or', 'not', 'if', 'else', 'begin', 'end'];
      if (!keywords.includes(match.toLowerCase()) && !variables.includes(match)) {
        variables.push(match);
      }
    }
  }

  return variables;
}
