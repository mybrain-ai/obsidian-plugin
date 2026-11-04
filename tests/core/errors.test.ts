import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HttpError,
  TokenRejectedError,
  isLastingRefusal,
  isProtocolRejection,
} from "@/core/errors";

test("4xx answers are lasting refusals, except a timeout or a rate limit", () => {
  for (const status of [400, 403, 404, 409, 413, 422]) {
    assert.equal(isLastingRefusal(new HttpError(status)), true, String(status));
  }

  for (const status of [408, 429, 500, 502, 503]) {
    assert.equal(
      isLastingRefusal(new HttpError(status)),
      false,
      String(status),
    );
  }
});

test("errors that are not HTTP answers are not lasting refusals", () => {
  assert.equal(isLastingRefusal(new Error("network down")), false);
  assert.equal(isLastingRefusal(new TokenRejectedError()), false);
  assert.equal(isLastingRefusal("plain"), false);
});

test("a 400 or 422 is a protocol rejection", () => {
  assert.equal(isProtocolRejection(new HttpError(400)), true);
  assert.equal(isProtocolRejection(new HttpError(422)), true);
});

test("other errors are not protocol rejections", () => {
  assert.equal(isProtocolRejection(new HttpError(409)), false);
  assert.equal(isProtocolRejection(new TokenRejectedError()), false);
  assert.equal(isProtocolRejection(new Error()), false);
});

test("HttpError carries its status", () => {
  const error = new HttpError(503);

  assert.equal(error.status, 503);
  assert.equal(error.name, "HttpError");
});
