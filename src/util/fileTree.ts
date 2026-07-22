export interface FileTreeResult {
  tree: string;
  truncated: boolean;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function newNode(): TreeNode {
  return { children: new Map(), isFile: false };
}

/**
 * Render a flat list of workspace-relative file paths as an indented tree.
 * Directories are listed before files at each level, both alphabetically.
 * Rendering stops after `maxEntries` lines to keep the prompt bounded.
 */
export function renderFileTree(paths: string[], maxEntries = 200): FileTreeResult {
  const root = newNode();

  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized) {
      continue;
    }
    const parts = normalized.split("/");
    let node = root;
    parts.forEach((part, index) => {
      let child = node.children.get(part);
      if (!child) {
        child = newNode();
        node.children.set(part, child);
      }
      if (index === parts.length - 1) {
        child.isFile = true;
      }
      node = child;
    });
  }

  const lines: string[] = [];
  let truncated = false;

  const walk = (node: TreeNode, depth: number): void => {
    if (truncated) {
      return;
    }
    const entries = [...node.children.entries()].sort((a, b) => {
      const aDir = a[1].children.size > 0 ? 0 : 1;
      const bDir = b[1].children.size > 0 ? 0 : 1;
      if (aDir !== bDir) {
        return aDir - bDir;
      }
      return a[0].localeCompare(b[0]);
    });

    for (const [name, child] of entries) {
      if (lines.length >= maxEntries) {
        truncated = true;
        return;
      }
      const indent = "  ".repeat(depth);
      const isDir = child.children.size > 0;
      lines.push(`${indent}${name}${isDir ? "/" : ""}`);
      if (isDir) {
        walk(child, depth + 1);
      }
    }
  };

  walk(root, 0);

  if (truncated) {
    lines.push("… (file list truncated)");
  }

  return { tree: lines.join("\n"), truncated };
}
