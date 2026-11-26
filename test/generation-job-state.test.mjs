import assert from "node:assert/strict";
import test from "node:test";
import { jobStatusSignature, newlyCompletedJobIds } from "../lib/generation-job-state.ts";

test("generation progress does not look like a job status change", () => {
  const running = [{ id: "job-1", status: "running", completed_sections: 1 }];
  const progressed = [{ id: "job-1", status: "running", completed_sections: 2 }];
  assert.equal(jobStatusSignature(running), jobStatusSignature(progressed));
});

test("only newly completed jobs trigger content refresh", () => {
  const jobs = [{ id: "job-1", status: "completed" }, { id: "job-2", status: "running" }];
  assert.deepEqual(newlyCompletedJobIds("job-1", jobs), []);
  assert.deepEqual(newlyCompletedJobIds("", jobs), ["job-1"]);
  assert.deepEqual(newlyCompletedJobIds("job-1", [{ ...jobs[0] }, { id: "job-2", status: "completed" }]), ["job-2"]);
});
