/**
 * 安全检测恶意关键词规则库
 */
const KEYWORD_RULES = Object.freeze({
  wholeWord: [
    "netcat", "php-cgi", "child_process", "execSync", "mainModule",
    "process.env", "require(", "exec("
  ],
  extensions: [
    ".php", ".asp", ".aspx", ".jsp", ".jspx", ".do", ".action", ".cgi",
    ".py", ".pl", ".cfm", ".jhtml", ".shtml", ".sql", ".env", ".git"
  ],
  directories: [
    "/administrator", "/wp-admin", "phpMyAdmin", "cgi-bin",
    "setup", "staging", "internal", "debug", "metadata", "secret"
  ],
  sqlInjection: [
    "sleep(", "extractvalue(", "updatexml(",
    "union select", "union all", "select @@", "drop ", "alter ", "truncate ",
    "(select", "information_schema", "load_file(", "into outfile", "into dumpfile"
  ],
  commandInjection: [
    "cmd=", "system(", "exec(", "shell_exec(", "passthru(",
    "eval(", "assert(", "preg_replace", "bash -i", "rm -rf",
    "wget ", "base64_decode", "phpinfo()",
    "killall", "shutdown", "fdisk", "mkfs", "dd ",
    "scp ", "rsync", "nc ", "netcat", "nmap", "iptables",
    "systemctl"
  ],
  pathTraversal: [
    "../", "..\\", "/etc/passwd", "/etc/shadow", "/etc/hosts",
    "/root/", "__dirname", "__filename"
  ],
  xss: [
    "<script", "javascript:", "onerror=", "onload=", "onclick=",
    "alert(", "document.cookie", "document.write"
  ],
  encoding: ["0x7e", "UNION%20SELECT", "%27OR%27"],
  sensitiveIdentifiers: [
    "wp-", ".well-known/",
    "fs.readFile", "fs.existsSync", "process.env", "process.argv"
  ],
});

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const PRIORITY = ["sqlInjection", "xss", "commandInjection"];

const escapeKeyword = (keyword, wholeWord = false) => {
  const str = keyword.replace(REGEX_SPECIAL, "\\$&").replace(/ /g, "\\s");
  return wholeWord ? `\\b${str}\\b` : str;
};

/**
 * 预构建每个分类的合并正则（priority 在前，其余按原顺序）
 */
const buildCategoryRegex = (cat, words) => {
  const wholeWord = cat === "wholeWord";
  return new RegExp(words.map(k => `(${escapeKeyword(k, wholeWord)})`).join("|"), "i");
};

const keywordRegexCache = (() => {
  const cache = {};
  for (const [cat, words] of Object.entries(KEYWORD_RULES)) {
    cache[cat] = { merged: buildCategoryRegex(cat, words) };
  }
  return cache;
})();

const SORTED_CATEGORIES = [
  ...PRIORITY,
  ...Object.keys(KEYWORD_RULES).filter(c => !PRIORITY.includes(c)),
];

export { KEYWORD_RULES, keywordRegexCache, SORTED_CATEGORIES };
