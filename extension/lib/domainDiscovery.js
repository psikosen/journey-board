function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2);
}

export class CorpusBuilder {
  constructor() {
    this.documents = new Map();
  }

  addDocument(id, text, metadata = {}) {
    const tokens = tokenize(text);
    const termFreq = new Map();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    this.documents.set(id, { text, metadata, termFreq, tokens });
  }

  tfidf() {
    const df = new Map();
    for (const { termFreq } of this.documents.values()) {
      for (const term of termFreq.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    const totalDocs = this.documents.size || 1;
    const matrix = new Map();
    for (const [id, { termFreq }] of this.documents.entries()) {
      const weights = new Map();
      const maxFreq = Math.max(...termFreq.values(), 1);
      for (const [term, freq] of termFreq.entries()) {
        const tf = 0.5 + (0.5 * freq) / maxFreq;
        const idf = Math.log((totalDocs + 1) / ((df.get(term) ?? 0) + 1)) + 1;
        weights.set(term, tf * idf);
      }
      matrix.set(id, weights);
    }
    return matrix;
  }
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    const va = a.get(key) ?? 0;
    const vb = b.get(key) ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function kmeans(vectors, k = 3, iterations = 8) {
  if (vectors.length === 0) {
    return [];
  }
  const centroids = vectors.slice(0, k).map(({ id, weights }) => ({ id, weights: new Map(weights) }));
  const assignments = new Map();
  for (let iter = 0; iter < iterations; iter += 1) {
    let changed = false;
    for (const vector of vectors) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < centroids.length; i += 1) {
        const score = cosineSimilarity(vector.weights, centroids[i].weights);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (assignments.get(vector.id) !== bestIndex) {
        changed = true;
      }
      assignments.set(vector.id, bestIndex);
    }
    if (!changed) break;
    for (let i = 0; i < centroids.length; i += 1) {
      const members = vectors.filter((vector) => assignments.get(vector.id) === i);
      const aggregate = new Map();
      for (const member of members) {
        for (const [term, weight] of member.weights.entries()) {
          aggregate.set(term, (aggregate.get(term) ?? 0) + weight);
        }
      }
      const divisor = members.length || 1;
      const weights = new Map();
      for (const [term, sum] of aggregate.entries()) {
        weights.set(term, sum / divisor);
      }
      centroids[i] = { id: centroids[i].id, weights };
    }
  }
  return Array.from(assignments.entries()).map(([id, cluster]) => ({ id, cluster }));
}

export function extractEntities(text) {
  const entities = new Map();
  const matches = text.matchAll(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/g);
  for (const [, entity] of matches) {
    const key = entity.toLowerCase();
    entities.set(key, { name: entity, count: (entities.get(key)?.count ?? 0) + 1 });
  }
  return Array.from(entities.values()).sort((a, b) => b.count - a.count);
}

export function buildEntityActionGraph(events) {
  const graph = new Map();
  for (const event of events) {
    if (!event.text) continue;
    const entities = extractEntities(event.text);
    for (const entity of entities) {
      const key = entity.name.toLowerCase();
      const node = graph.get(key) ?? { name: entity.name, actions: new Map(), count: 0 };
      node.count += 1;
      const action = event.type;
      node.actions.set(action, (node.actions.get(action) ?? 0) + 1);
      graph.set(key, node);
    }
  }
  return graph;
}

export function scoreAutomation(processes, graph) {
  return processes.map((process) => {
    const hash = hashString(process.steps.join('>'));
    let interactionScore = 0;
    for (const step of process.steps) {
      const key = step.toLowerCase();
      const node = graph.get(key);
      if (node) {
        interactionScore += node.count;
      }
    }
    const effort = process.averageDuration ?? 0;
    const support = process.support ?? 0;
    const score = support * 2 + interactionScore - effort * 0.1;
    return {
      id: hash,
      process,
      score: Number(score.toFixed(2)),
      interactionScore,
      effort,
      support,
    };
  });
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

