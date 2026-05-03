import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const jobsSource = readFileSync("src/lib/server/voiceover/jobs.ts", "utf8");
const workspaceSource = readFileSync("src/components/projects/ProjectVoiceoverWorkspace.tsx", "utf8");

test("voiceover result downloads do not delete the generated audio before the client saves it", () => {
  const consumeFunction = jobsSource.slice(
    jobsSource.indexOf("export function consumeVoiceoverJobResult"),
  );

  assert.doesNotMatch(consumeFunction, /fs\.unlinkSync/);
  assert.doesNotMatch(consumeFunction, /voiceoverJobRepository\.delete/);
});

test("a pending voiceover job blocks starting a duplicate generation after remount", () => {
  assert.match(workspaceSource, /const hasPendingVoiceoverJob = Boolean\(draft\.pendingJobId \|\| activeJobId\)/);
  assert.match(workspaceSource, /disabled=\{!canGenerate \|\| hasPendingVoiceoverJob\}/);
});
