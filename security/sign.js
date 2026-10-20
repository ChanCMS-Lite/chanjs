/**
 * AES-256-GCM 加解密工具，内置scrypt密钥派生+LRU缓存
 */
import crypto from "node:crypto";
import logger from "../utils/logger.js";

const AES_CFG = Object.freeze({
  ALG: "aes-256-gcm",
  IV_LEN: 12,
  TAG_LEN: 16,
  KEY_BYTES: 32,
  SCRYPT_N: 16384,
  SCRYPT_R: 8,
  SCRYPT_P: 1,
  CACHE_MAX: 100,
});

const keyCache = new Map();
let saltWarnFlag = false;

/**
 * scrypt派生32字节AES密钥，带LRU缓存复用
 * @param {string} secret
 * @returns {Promise<Buffer|null>}
 */
const deriveKey = async secret => {
  if (!secret || typeof secret !== "string") return null;

  // LRU 命中
  if (keyCache.has(secret)) {
    const buf = keyCache.get(secret);
    keyCache.delete(secret);
    keyCache.set(secret, buf);
    return buf;
  }

  // 派生盐：环境变量优先，否则警告并用 secret 派生
  let salt;
  if (process.env.AES_SALT) {
    salt = crypto.createHash("sha256").update(process.env.AES_SALT).digest();
  } else {
    if (!saltWarnFlag) {
      logger.warn("[安全警告] 未配置环境变量 AES_SALT，建议统一配置固定盐值");
      saltWarnFlag = true;
    }
    salt = crypto.createHash("sha256").update(secret).digest();
  }

  // scrypt 异步派生
  const keyBuf = await new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, AES_CFG.KEY_BYTES, {
      N: AES_CFG.SCRYPT_N, r: AES_CFG.SCRYPT_R, p: AES_CFG.SCRYPT_P,
    }, (err, derivedKey) => err ? reject(err) : resolve(derivedKey));
  });

  // LRU 淘汰
  if (keyCache.size >= AES_CFG.CACHE_MAX) {
    const oldest = keyCache.keys().next().value;
    if (oldest !== undefined) keyCache.delete(oldest);
  }
  keyCache.set(secret, keyBuf);
  return keyBuf;
};

/**
 * AES加密：输出iv+tag+密文合并base64
 * @param {string|object} data
 * @param {string} secret
 * @returns {Promise<string|null>}
 */
export const aesEncrypt = async (data, secret) => {
  if (!secret) return logger.error("[安全错误] 加密密钥secret不能为空"), null;
  try {
    const key = await deriveKey(secret);
    if (!key) return null;

    const iv = crypto.randomBytes(AES_CFG.IV_LEN);
    const cipher = crypto.createCipheriv(AES_CFG.ALG, key, iv);
    const plain = typeof data === "string" ? data : JSON.stringify(data);

    const cipherBuf = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, cipherBuf]).toString("base64");
  } catch (err) {
    logger.error("AES加密失败", err.message);
    return null;
  }
};

/**
 * AES解密，校验GCM完整性tag防篡改
 * @param {string} base64Str
 * @param {string} secret
 * @returns {Promise<string|null>}
 */
export const aesDecrypt = async (base64Str, secret) => {
  if (!secret) return logger.error("[安全错误] 解密密钥secret不能为空"), null;
  try {
    const key = await deriveKey(secret);
    if (!key) return null;

    const raw = Buffer.from(base64Str, "base64");
    const minLen = AES_CFG.IV_LEN + AES_CFG.TAG_LEN;
    if (raw.length < minLen) return null;

    const iv = raw.subarray(0, AES_CFG.IV_LEN);
    const tag = raw.subarray(AES_CFG.IV_LEN, minLen);
    const cipherBuf = raw.subarray(minLen);

    const decipher = crypto.createDecipheriv(AES_CFG.ALG, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString("utf8");
  } catch (err) {
    logger.error("AES解密失败", err.message);
    return null;
  }
};
