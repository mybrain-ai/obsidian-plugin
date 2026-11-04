import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { ObsidianUploadFailurePrompt } from "@/ui/upload-failure-notice";

import { type FakeElement, Notice } from "@test/stubs/obsidian";

beforeEach(() => {
  Notice.all.length = 0;
});

test("the notice stays until closed and shows the count with Retry and Dismiss", () => {
  const prompt = new ObsidianUploadFailurePrompt();

  prompt.show(2, () => {});

  const [notice] = Notice.all;

  assert.equal(notice.duration, 0);
  assert.deepEqual(_message(notice).texts(), [
    "MyBrain: 2 attachments could not be uploaded.",
    "Retry",
    "Dismiss",
  ]);
});

test("Retry closes the notice and runs the retry", () => {
  const prompt = new ObsidianUploadFailurePrompt();
  let retried = 0;

  prompt.show(1, () => retried++);
  _message(Notice.all[0]).button("Retry")?.click();

  assert.equal(retried, 1);
  assert.equal(Notice.all[0].containerEl.isConnected, false);
});

test("Dismiss closes the notice without a retry", () => {
  const prompt = new ObsidianUploadFailurePrompt();
  let retried = 0;

  prompt.show(1, () => retried++);
  _message(Notice.all[0]).button("Dismiss")?.click();

  assert.equal(retried, 0);
  assert.equal(Notice.all[0].containerEl.isConnected, false);
});

test("while it is open, show and update change its count instead of opening another", () => {
  const prompt = new ObsidianUploadFailurePrompt();

  prompt.show(1, () => {});
  prompt.show(2, () => {});
  assert.equal(Notice.all.length, 1);
  assert.equal(
    _message(Notice.all[0]).texts()[0],
    "MyBrain: 2 attachments could not be uploaded.",
  );

  prompt.update(3);
  assert.equal(
    _message(Notice.all[0]).texts()[0],
    "MyBrain: 3 attachments could not be uploaded.",
  );
});

test("once closed, update does nothing and show opens a new notice", () => {
  const prompt = new ObsidianUploadFailurePrompt();

  prompt.show(1, () => {});
  prompt.close();
  prompt.update(5);

  assert.equal(
    _message(Notice.all[0]).texts()[0],
    "MyBrain: 1 attachment could not be uploaded.",
  );

  prompt.show(2, () => {});
  assert.equal(Notice.all.length, 2);
});

test("a notice the user clicked away counts as closed", () => {
  const prompt = new ObsidianUploadFailurePrompt();

  prompt.show(1, () => {});
  Notice.all[0].hide();
  prompt.show(1, () => {});

  assert.equal(Notice.all.length, 2);
});

function _message(notice: Notice): FakeElement {
  return notice.message as FakeElement;
}
