/** Explicit maintenance command; checks consume frozen fixtures and never refresh them. */
for (const name of ['capture-fixtures', 'capture-damage-fixtures', 'capture-contact-fixtures', 'capture-impact-fixtures', 'capture-projectile-fixtures', 'capture-bot-fixtures', 'capture-underwater-fixtures', 'capture-collision-fixtures', 'capture-flight-fixtures', 'capture-aviation-fixtures', 'capture-battle-fixtures']) {
 const child = Bun.spawn([process.execPath, `scripts/multiplayer/${name}.ts`], { stdout: 'inherit', stderr: 'inherit' });
 if (await child.exited) throw new Error(`Fixture capture failed: ${name}`);
}
