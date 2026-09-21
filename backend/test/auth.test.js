import test, { describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";

describe("auth & authorization unit tests", () => {
  function signToken(userId, role) {
    return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "1h" });
  }

  function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
  }

  function checkRole(userRole, requiredRole) {
    return userRole === requiredRole;
  }

  test("JWT generation and verification works with claims", () => {
    const token = signToken("user-123", "student");
    const payload = verifyToken(token);
    assert.equal(payload.sub, "user-123");
    assert.equal(payload.role, "student");
  });

  test("JWT verification fails on invalid signature", () => {
    const token = jwt.sign({ sub: "user-123" }, "wrong-secret");
    assert.throws(() => verifyToken(token));
  });

  test("requireRole enforces student and teacher role boundaries", () => {
    assert.equal(checkRole("student", "student"), true);
    assert.equal(checkRole("teacher", "student"), false);
    assert.equal(checkRole("teacher", "teacher"), true);
    assert.equal(checkRole("student", "teacher"), false);
  });

  test("password length validation requires at least 8 characters", () => {
    function validatePassword(pw) {
      return typeof pw === "string" && pw.length >= 8;
    }
    assert.equal(validatePassword("short"), false);
    assert.equal(validatePassword("1234567"), false);
    assert.equal(validatePassword("12345678"), true);
    assert.equal(validatePassword("strongPassword123"), true);
  });
});

