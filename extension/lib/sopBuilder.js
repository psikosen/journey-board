export function buildMarkdown(process) {
  const lines = [`# ${process.name || 'Standard Operating Procedure'}`];
  lines.push('', `**Process ID:** ${process.id ?? process.name ?? 'unknown'}`);
  lines.push('', '## Steps');
  process.steps.forEach((step, index) => {
    lines.push(`### Step ${index + 1}: ${step.title}`);
    if (step.description) {
      lines.push('', step.description);
    }
    if (step.actors?.length) {
      lines.push('', `**Actors:** ${step.actors.join(', ')}`);
    }
    if (step.inputs?.length) {
      lines.push('', `**Inputs:** ${step.inputs.join(', ')}`);
    }
    if (step.outputs?.length) {
      lines.push('', `**Outputs:** ${step.outputs.join(', ')}`);
    }
    if (step.systems?.length) {
      lines.push('', `**Systems:** ${step.systems.join(', ')}`);
    }
    if (step.notes) {
      lines.push('', `> ${step.notes}`);
    }
    lines.push('');
  });
  return `${lines.join('\n')}\n`;
}

export function buildYaml(process) {
  const entries = [];
  entries.push('sop:');
  entries.push(`  name: ${escapeYaml(process.name || 'Standard Operating Procedure')}`);
  entries.push(`  id: ${escapeYaml(process.id ?? process.name ?? 'unknown')}`);
  entries.push('  steps:');
  process.steps.forEach((step, index) => {
    entries.push(`    - number: ${index + 1}`);
    entries.push(`      title: ${escapeYaml(step.title)}`);
    if (step.description) entries.push(`      description: ${escapeYaml(step.description)}`);
    if (step.actors?.length) entries.push(`      actors: ${formatYamlList(step.actors)}`);
    if (step.inputs?.length) entries.push(`      inputs: ${formatYamlList(step.inputs)}`);
    if (step.outputs?.length) entries.push(`      outputs: ${formatYamlList(step.outputs)}`);
    if (step.systems?.length) entries.push(`      systems: ${formatYamlList(step.systems)}`);
    if (step.notes) entries.push(`      notes: ${escapeYaml(step.notes)}`);
  });
  return `${entries.join('\n')}\n`;
}

function escapeYaml(value) {
  if (value === null || value === undefined) {
    return "''";
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatYamlList(values) {
  return `[` + values.map((value) => escapeYaml(value)).join(', ') + `]`;
}

export function buildBpmn(process) {
  const ns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const xsi = 'http://www.w3.org/2001/XMLSchema-instance';
  const doc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<definitions xmlns="${ns}" xmlns:xsi="${xsi}" targetNamespace="${process.id ?? 'SOP'}">`,
    `  <process id="${process.id ?? 'Process_1'}" name="${process.name ?? 'SOP'}" isExecutable="false">`,
  ];
  doc.push('    <startEvent id="StartEvent_1" name="Start"/>');
  process.steps.forEach((step, index) => {
    const activityId = `Activity_${index + 1}`;
    doc.push(
      `    <task id="${activityId}" name="${step.title}">` +
        (step.notes ? `<!-- ${step.notes} -->` : '') +
        '</task>',
    );
  });
  doc.push('    <endEvent id="EndEvent_1" name="Complete"/>');
  doc.push('  </process>', '</definitions>');
  return `${doc.join('\n')}\n`;
}

export function hashProcess(process) {
  return hashString(JSON.stringify(process));
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

