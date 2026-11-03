const crypto = require("crypto");

const ABHA_BASE =
  process.env.ABDM_BASE_URL || "https://abhasbx.abdm.gov.in/abha/api";

const SESSION_URL =
  process.env.ABDM_SESSION_URL ||
  "https://dev.abdm.gov.in/gateway/v0.5/sessions";

const TIMEOUT = 15000;
const SESSION_SAFETY_BUFFER_MS = 60 * 1000;
const CERTIFICATE_CACHE_MS = 15 * 60 * 1000;

let cachedSession = null;
let cachedKey = null;
let sessionPromise = null;
let certificatePromise = null;

// --------------------------------------------------
// SESSION: Use actual expiresIn from ABDM response
// --------------------------------------------------

async function getSession() {
  if (cachedSession && cachedSession.exp > Date.now()) {
    return cachedSession.token;
  }

  // Avoid multiple simultaneous session requests
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    const response = await fetch(SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: process.env.ABDM_CLIENT_ID,
        clientSecret: process.env.ABDM_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.accessToken) {
      throw new Error(`ABDM session request failed (HTTP ${response.status})`);
    }

    const expiresIn = Number(data.expiresIn);

    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("ABDM session response has invalid expiresIn");
    }

    // expiresIn is in seconds.
    // Refresh before the token actually expires.
    const lifetimeMs = expiresIn * 1000;
    const usableLifetimeMs = lifetimeMs - SESSION_SAFETY_BUFFER_MS;

    cachedSession = {
      token: data.accessToken,
      exp: Date.now() + Math.max(0, usableLifetimeMs),
    };

    // Do not keep an already-expired/near-expiry token cached.
    if (usableLifetimeMs <= 0) {
      cachedSession = null;
    }

    return data.accessToken;
  })();

  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

// --------------------------------------------------
// COMMON HEADERS
// --------------------------------------------------

function headers(token) {
  const result = {
    "Content-Type": "application/json",
    "REQUEST-ID": crypto.randomUUID(),
    TIMESTAMP: new Date().toISOString(),
  };

  if (token) {
    result.Authorization = `Bearer ${token}`;
  }

  // Configure this according to the ABDM environment
  // and the CM-ID assigned to your integration.
  const cmId = process.env.ABDM_CM_ID || "sbx";

  if (cmId) {
    result["X-CM-ID"] = cmId;
  }

  return result;
}

// --------------------------------------------------
// PUBLIC CERTIFICATE
// --------------------------------------------------

async function getPublicKey() {
  if (cachedKey && cachedKey.exp > Date.now()) {
    return cachedKey;
  }

  if (certificatePromise) {
    return certificatePromise;
  }

  certificatePromise = (async () => {
    const token = await getSession();

    const response = await fetch(`${ABHA_BASE}/v3/profile/public/certificate`, {
      method: "GET",
      headers: headers(token),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(
        `ABDM certificate request failed (HTTP ${response.status})`,
      );
    }

    const responseText = (await response.text()).trim();

    let certificateData;

    try {
      certificateData = JSON.parse(responseText);
    } catch {
      // A plain-text key is accepted only if the algorithm
      // is explicitly configured from trusted documentation.
      certificateData = {
        publicKey: responseText,
        encryptionAlgorithm: process.env.ABDM_ENCRYPTION_ALGORITHM,
      };
    }

    const publicKeyValue = certificateData?.publicKey;

    const algorithm =
      certificateData?.encryptionAlgorithm ||
      process.env.ABDM_ENCRYPTION_ALGORITHM;

    if (typeof publicKeyValue !== "string" || !publicKeyValue.trim()) {
      throw new Error("ABDM certificate response has no publicKey");
    }

    if (typeof algorithm !== "string" || !algorithm.trim()) {
      throw new Error("ABDM encryptionAlgorithm is missing; refusing to guess");
    }

    // The documented V3 algorithm is RSA OAEP with SHA-1.
    // Node uses the same hash for OAEP and MGF1 here.
    const supportedAlgorithms = new Set([
      "RSA/ECB/OAEPWithSHA-1AndMGF1Padding",
    ]);

    if (!supportedAlgorithms.has(algorithm.trim())) {
      throw new Error(`Unsupported ABDM encryption algorithm: ${algorithm}`);
    }

    let keyInput = publicKeyValue.trim();

    // Support either a PEM key/certificate or a Base64
    // encoded DER SubjectPublicKeyInfo public key.
    if (!keyInput.includes("-----BEGIN")) {
      const base64 = keyInput.replace(/\s/g, "");

      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) {
        throw new Error("ABDM publicKey is not valid Base64");
      }

      keyInput =
        "-----BEGIN PUBLIC KEY-----\n" +
        base64.match(/.{1,64}/g).join("\n") +
        "\n-----END PUBLIC KEY-----";
    }

    let keyObject;

    try {
      keyObject = crypto.createPublicKey(keyInput);
    } catch {
      throw new Error("Unable to parse ABDM public key/certificate");
    }

    if (keyObject.asymmetricKeyType !== "rsa") {
      throw new Error("ABDM encryption key is not an RSA public key");
    }

    const pem = keyObject.export({
      type: "spki",
      format: "pem",
    });

    cachedKey = {
      key: pem,
      algorithm: algorithm.trim(),
      exp: Date.now() + CERTIFICATE_CACHE_MS,
    };

    return cachedKey;
  })();

  try {
    return await certificatePromise;
  } finally {
    certificatePromise = null;
  }
}

// --------------------------------------------------
// ENCRYPT SENSITIVE DATA
// --------------------------------------------------

async function encrypt(plain) {
  if (plain === undefined || plain === null || plain === "") {
    throw new Error("Cannot encrypt an empty value");
  }

  const certificate = await getPublicKey();

  if (certificate.algorithm !== "RSA/ECB/OAEPWithSHA-1AndMGF1Padding") {
    throw new Error("Unsupported encryption algorithm");
  }

  return crypto
    .publicEncrypt(
      {
        key: certificate.key,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha1",
      },
      Buffer.from(String(plain), "utf8"),
    )
    .toString("base64");
}

// --------------------------------------------------
// ABDM POST HELPER
// --------------------------------------------------

async function abhaPost(path, body, extraHeaders = {}) {
  const token = await getSession();

  const r = await fetch(`${ABHA_BASE}${path}`, {
    method: "POST",
    headers: {
      ...headers(token),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });

  const data = await r.json().catch(() => ({}));

  return {
    ok: r.ok,
    status: r.status,
    data,
  };
}

module.exports = {
  encrypt,
  abhaPost,
};
