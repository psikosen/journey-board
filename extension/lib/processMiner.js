function normalizeStep(step) {
  if (!step) {
    return 'unknown';
  }
  return step.toLowerCase();
}

class PrefixNode {
  constructor(label = '__root__') {
    this.label = label;
    this.support = 0;
    this.children = new Map();
    this.duration = 0;
  }

  child(label) {
    const key = normalizeStep(label);
    if (!this.children.has(key)) {
      this.children.set(key, new PrefixNode(key));
    }
    return this.children.get(key);
  }

  toJSON(path = []) {
    const step = {
      label: this.label,
      support: this.support,
      duration: this.duration,
      path,
      children: [],
    };
    for (const child of this.children.values()) {
      step.children.push(child.toJSON([...path, child.label]));
    }
    return step;
  }
}

export class PrefixTreeMiner {
  constructor(options = {}) {
    this.root = new PrefixNode();
    this.minSupport = options.minSupport ?? 2;
    this.minLength = options.minLength ?? 2;
  }

  ingest(trace, duration = 0) {
    if (!Array.isArray(trace) || trace.length === 0) {
      return;
    }
    let node = this.root;
    node.support += 1;
    for (const step of trace) {
      node = node.child(step);
      node.support += 1;
      node.duration += duration;
    }
  }

  #collect(node = this.root, path = [], results = []) {
    for (const child of node.children.values()) {
      const nextPath = [...path, child.label];
      if (child.support >= this.minSupport && nextPath.length >= this.minLength) {
        results.push({
          steps: nextPath,
          support: child.support,
          averageDuration: child.support ? child.duration / child.support : 0,
        });
      }
      this.#collect(child, nextPath, results);
    }
    return results;
  }

  extractProcesses() {
    const processes = this.#collect();
    processes.sort((a, b) => b.support - a.support || a.steps.length - b.steps.length);
    return processes;
  }

  toJSON() {
    return this.root.toJSON();
  }
}

export function mineProcesses(traces, options = {}) {
  const miner = new PrefixTreeMiner(options);
  for (const trace of traces) {
    miner.ingest(trace.steps, trace.duration ?? 0);
  }
  return miner.extractProcesses();
}

