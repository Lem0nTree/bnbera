import { buildSemanticDocument } from './semantic.js';
import { classifyAgent } from './categorization.js';
import type { DirectorySnapshot } from './directory.js';

/** Only stable, public descriptive fields enter the directory vector. */
export function buildDirectorySemanticDocument(snapshot: DirectorySnapshot) {
  const category=classifyAgent({name:snapshot.name,description:snapshot.description,supportedProtocols:snapshot.protocols,advertisedSkills:snapshot.skills}).category;
  return buildSemanticDocument({identity:snapshot.identity,category,name:snapshot.name,
    description:snapshot.description,protocols:snapshot.protocols,
    capabilityManifest:{capabilities:snapshot.skills.slice(0,16).map(skill=>({id:skill.id,description:`${skill.name}: ${skill.description}`.slice(0,400)}))}});
}
