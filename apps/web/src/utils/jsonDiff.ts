/**
 * JSON Diff & Structural Delta Generator
 * 
 * Computes deep differences between two JSON structures:
 * - Summary counts (added, removed, modified)
 * - Specialized Views array analysis (by `view` key for Tenant Configurations)
 * - Path-based changes (`path.to.key`)
 * - RFC 6902 JSON Patch operations
 */

export type DeltaFormat = "full" | "compact" | "patch" | "views";

export interface ViewDiffItem {
  view: string;
  changes: Record<string, { baseline: any; target: any }>;
}

export interface ViewsAnalysis {
  onlyInBaseline: string[];
  onlyInTarget: string[];
  modifiedViews: ViewDiffItem[];
}

export interface RFC6902Op {
  op: "add" | "remove" | "replace";
  path: string;
  value?: any;
  oldValue?: any;
}

export interface JsonDeltaOutput {
  _meta?: {
    generatedAt: string;
    baseline: string;
    target: string;
    direction: string;
  };
  summary: {
    totalChanges: number;
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    viewsDiff?: {
      onlyInBaseline: number;
      onlyInTarget: number;
      modifiedViews: number;
    };
  };
  viewsAnalysis?: ViewsAnalysis;
  differences: {
    added: Record<string, any>;
    removed: Record<string, any>;
    modified: Record<string, { baseline: any; target: any }>;
  };
  rfc6902Patch: RFC6902Op[];
}

/**
 * Escapes a token for RFC 6901 JSON Pointer.
 */
function escapeJsonPointer(token: string | number): string {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Performs deep equality check between two values.
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}

/**
 * Calculates deep differences between baseline and target objects.
 */
export function calculateJsonDelta(
  baseline: any,
  target: any,
  baselineLabel = "Baseline",
  targetLabel = "Target"
): JsonDeltaOutput {
  const added: Record<string, any> = {};
  const removed: Record<string, any> = {};
  const modified: Record<string, { baseline: any; target: any }> = {};
  const rfc6902Patch: RFC6902Op[] = [];

  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;

  function walk(base: any, tgt: any, dotPath: string, pointerPath: string) {
    if (deepEqual(base, tgt)) return;

    // Case 1: Both are primitive or either is not an object/null
    if (
      base === null ||
      tgt === null ||
      typeof base !== "object" ||
      typeof tgt !== "object" ||
      Array.isArray(base) !== Array.isArray(tgt)
    ) {
      modified[dotPath || "root"] = { baseline: base, target: tgt };
      modifiedCount++;
      rfc6902Patch.push({
        op: "replace",
        path: pointerPath || "/",
        value: tgt,
        oldValue: base
      });
      return;
    }

    // Case 2: Both are arrays
    if (Array.isArray(base) && Array.isArray(tgt)) {
      const maxLen = Math.max(base.length, tgt.length);
      for (let i = 0; i < maxLen; i++) {
        const itemDot = dotPath ? `${dotPath}[${i}]` : `[${i}]`;
        const itemPtr = `${pointerPath}/${escapeJsonPointer(i)}`;

        if (i >= base.length) {
          added[itemDot] = tgt[i];
          addedCount++;
          rfc6902Patch.push({
            op: "add",
            path: itemPtr,
            value: tgt[i]
          });
        } else if (i >= tgt.length) {
          removed[itemDot] = base[i];
          removedCount++;
          rfc6902Patch.push({
            op: "remove",
            path: itemPtr,
            oldValue: base[i]
          });
        } else {
          walk(base[i], tgt[i], itemDot, itemPtr);
        }
      }
      return;
    }

    // Case 3: Both are plain objects
    const baseKeys = new Set(Object.keys(base));
    const tgtKeys = new Set(Object.keys(tgt));

    // Keys in target but not in baseline -> Added
    for (const key of tgtKeys) {
      const currentDot = dotPath ? `${dotPath}.${key}` : key;
      const currentPtr = `${pointerPath}/${escapeJsonPointer(key)}`;

      if (!baseKeys.has(key)) {
        added[currentDot] = tgt[key];
        addedCount++;
        rfc6902Patch.push({
          op: "add",
          path: currentPtr,
          value: tgt[key]
        });
      } else {
        walk(base[key], tgt[key], currentDot, currentPtr);
      }
    }

    // Keys in baseline but not in target -> Removed
    for (const key of baseKeys) {
      if (!tgtKeys.has(key)) {
        const currentDot = dotPath ? `${dotPath}.${key}` : key;
        const currentPtr = `${pointerPath}/${escapeJsonPointer(key)}`;
        removed[currentDot] = base[key];
        removedCount++;
        rfc6902Patch.push({
          op: "remove",
          path: currentPtr,
          oldValue: base[key]
        });
      }
    }
  }

  walk(baseline, target, "", "");

  // Specialized Views Analysis if either object contains a 'views' array
  let viewsAnalysis: ViewsAnalysis | undefined;
  if (Array.isArray(baseline?.views) || Array.isArray(target?.views)) {
    const baseViews: any[] = Array.isArray(baseline?.views) ? baseline.views : [];
    const tgtViews: any[] = Array.isArray(target?.views) ? target.views : [];

    const baseMap = new Map<string, any>();
    const tgtMap = new Map<string, any>();

    baseViews.forEach(v => {
      const key = v?.view || v?.id || v?.key;
      if (key) baseMap.set(String(key), v);
    });

    tgtViews.forEach(v => {
      const key = v?.view || v?.id || v?.key;
      if (key) tgtMap.set(String(key), v);
    });

    const onlyInBaseline: string[] = [];
    const onlyInTarget: string[] = [];
    const modifiedViews: ViewDiffItem[] = [];

    for (const key of baseMap.keys()) {
      if (!tgtMap.has(key)) {
        onlyInBaseline.push(key);
      }
    }

    for (const [key, tgtViewObj] of tgtMap.entries()) {
      if (!baseMap.has(key)) {
        onlyInTarget.push(key);
      } else {
        const baseViewObj = baseMap.get(key);
        if (!deepEqual(baseViewObj, tgtViewObj)) {
          const propChanges: Record<string, { baseline: any; target: any }> = {};
          const allProps = new Set([...Object.keys(baseViewObj), ...Object.keys(tgtViewObj)]);
          for (const prop of allProps) {
            if (!deepEqual(baseViewObj[prop], tgtViewObj[prop])) {
              propChanges[prop] = {
                baseline: baseViewObj[prop],
                target: tgtViewObj[prop]
              };
            }
          }
          if (Object.keys(propChanges).length > 0) {
            modifiedViews.push({
              view: key,
              changes: propChanges
            });
          }
        }
      }
    }

    viewsAnalysis = {
      onlyInBaseline,
      onlyInTarget,
      modifiedViews
    };
  }

  const totalChanges = addedCount + removedCount + modifiedCount;

  return {
    _meta: {
      generatedAt: new Date().toISOString(),
      baseline: baselineLabel,
      target: targetLabel,
      direction: `${baselineLabel} ➔ ${targetLabel}`
    },
    summary: {
      totalChanges,
      addedCount,
      removedCount,
      modifiedCount,
      ...(viewsAnalysis ? {
        viewsDiff: {
          onlyInBaseline: viewsAnalysis.onlyInBaseline.length,
          onlyInTarget: viewsAnalysis.onlyInTarget.length,
          modifiedViews: viewsAnalysis.modifiedViews.length
        }
      } : {})
    },
    ...(viewsAnalysis ? { viewsAnalysis } : {}),
    differences: {
      added,
      removed,
      modified
    },
    rfc6902Patch
  };
}

/**
 * Returns JSON string formatted according to desired format mode.
 */
export function formatDeltaOutput(
  delta: JsonDeltaOutput,
  format: DeltaFormat = "full",
  indent = 2
): string {
  switch (format) {
    case "compact":
      return JSON.stringify(
        {
          summary: delta.summary,
          added: delta.differences.added,
          removed: delta.differences.removed,
          modified: delta.differences.modified
        },
        null,
        indent
      );

    case "patch":
      return JSON.stringify(delta.rfc6902Patch, null, indent);

    case "views":
      return JSON.stringify(
        {
          summary: delta.summary.viewsDiff || { onlyInBaseline: 0, onlyInTarget: 0, modifiedViews: 0 },
          viewsAnalysis: delta.viewsAnalysis || { onlyInBaseline: [], onlyInTarget: [], modifiedViews: [] }
        },
        null,
        indent
      );

    case "full":
    default:
      return JSON.stringify(delta, null, indent);
  }
}
