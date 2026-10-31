#!/usr/bin/env node
/**
 * Sync the Anitech team into Cursor rules.
 *
 *   agents/roster.json + agents/personas/<id>.md + upstream agency-agents
 *     → vendor/agency-agents/**          (pinned copy of the upstream files we use)
 *     → .cursor/rules/*.mdc              (GENERATED — edit agents/ instead)
 *
 * Upstream location: $AGENCY_AGENTS_DIR (default C:/laragon/www/agency-agents).
 * If that directory does not exist the pinned copy in vendor/ is used as is.
 *
 * The .mdc layout matches convert_cursor() in agency-agents/scripts/convert.sh:
 *   ---\n description: '<yaml-quoted>'\n globs: ""\n alwaysApply: false\n---\n <body>
 * Pure Node, no dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_UPSTREAM_DIR = "C:/laragon/www/agency-agents";
export const TEAM_RULE = "00-anitech-team";

export function defaultPaths(root = ROOT) {
  return {
    rosterPath: path.join(root, "agents", "roster.json"),
    rosterSocialPath: path.join(root, "agents", "roster-social.json"),
    personasDir: path.join(root, "agents", "personas"),
    vendorDir: path.join(root, "vendor", "agency-agents"),
    outDir: path.join(root, ".cursor", "rules"),
    upstreamDir: process.env.AGENCY_AGENTS_DIR || DEFAULT_UPSTREAM_DIR,
  };
}

const normalize = (text) => text.replace(/\r\n?/g, "\n");

/** Single-quoted YAML scalar, same as yaml_quote() in convert.sh. */
export function yamlQuote(value) {
  return "'" + String(value).replace(/\n+/g, " ").replace(/'/g, "''") + "'";
}

/** Split an upstream agent file into { fields, body }. The upstream frontmatter is dropped. */
export function parseAgentFile(raw) {
  const text = normalize(raw);
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { fields: {}, body: text.trim() };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!field) continue;
    fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: text.slice(match[0].length).trim() };
}

export function mdc({ description, alwaysApply, body }) {
  return `---\ndescription: ${yamlQuote(description)}\nglobs: ""\nalwaysApply: ${alwaysApply}\n---\n${body.trim()}\n`;
}

function readRoster(rosterPath) {
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  if (!Array.isArray(roster) || roster.length === 0) throw new Error(`${rosterPath}: roster must be a non-empty array`);
  const seen = { id: new Set(), rule: new Set() };
  for (const member of roster) {
    for (const key of ["id", "name", "title", "rule"]) {
      if (typeof member[key] !== "string" || !member[key]) throw new Error(`roster: "${member.id ?? "?"}" is missing "${key}"`);
    }
    if (!Array.isArray(member.agents) || member.agents.length === 0) throw new Error(`roster: "${member.id}" has no upstream agents`);
    for (const key of ["id", "rule"]) {
      if (seen[key].has(member[key])) throw new Error(`roster: duplicate ${key} "${member[key]}"`);
      seen[key].add(member[key]);
    }
  }
  return roster;
}

/** Copy every upstream file referenced by the roster into vendor/. Returns the list of copied paths. */
function copyUpstream(roster, upstreamDir, vendorDir) {
  const copied = [];
  for (const member of roster) {
    for (const relative of member.agents) {
      const source = path.join(upstreamDir, relative);
      if (!fs.existsSync(source)) throw new Error(`Upstream agent not found: ${source}`);
      const target = path.join(vendorDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, normalize(fs.readFileSync(source, "utf8")));
      copied.push(relative);
    }
  }
  return copied;
}

function loadSkills(member, vendorDir) {
  return member.agents.map((relative) => {
    const file = path.join(vendorDir, relative);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file}. Set AGENCY_AGENTS_DIR to the agency-agents checkout, or restore vendor/.`);
    }
    const { fields, body } = parseAgentFile(fs.readFileSync(file, "utf8"));
    return { relative, name: fields.name || path.basename(relative, ".md"), description: fields.description || "", body };
  });
}

function memberRule(member, persona, skills) {
  const description = `${member.name} — ${member.title} của Anitech Agency. ` + skills.map((skill) => skill.description).filter(Boolean).join(" | ");
  const sections = [persona.trim()];
  for (const skill of skills) sections.push(`## Kỹ năng: ${skill.name}\n\n${skill.body}`);
  return mdc({ description, alwaysApply: false, body: sections.join("\n\n") });
}

const DUTIES = {
  it: { lead: "ceo", gate: "reality", fallback: "senior", testing: "testing", security: "security" },
  social: { lead: "socialCeo", gate: "director", fallback: "copy" },
};

function byRole(roster, role) {
  return role ? roster.find((member) => member.role === role) : undefined;
}

function departmentBlock(dept, skillsById) {
  const duty = DUTIES[dept.id] ?? DUTIES.it;
  const lead = byRole(dept.roster, duty.lead) ?? dept.roster[0];
  const gate = byRole(dept.roster, duty.gate);
  const fallback = byRole(dept.roster, duty.fallback);
  const tester = byRole(dept.roster, duty.testing) ?? gate;
  const rows = dept.roster.map((member) => {
    const skills = skillsById.get(member.id).map((skill) => skill.name).join(" + ");
    return `| ${member.name} | ${member.title} | \`@${member.rule}\` | ${skills} |`;
  });
  const routing = dept.roster
    .filter((member) => member.keywords?.length)
    .map((member) => `- **${member.name}**: ${member.keywords.join(", ")}`);
  const reviewStep = tester && gate && tester.id !== gate.id
    ? `4. Mỗi task đi theo vòng: người làm → ${tester.name} kiểm thử → (FAIL thì trả lại người làm) → PASS mới sang task kế.\n5. Khi mọi task PASS, ${gate.name} làm cổng cuối. Mặc định "NEEDS WORK" cho tới khi có bằng chứng.`
    : `4. Mỗi task đi theo vòng: người làm → ${gate?.name ?? "người duyệt"} duyệt chất lượng nội dung → (FAIL thì trả lại người làm) → PASS mới sang task kế.\n5. ${gate?.name ?? "Người duyệt"} là cổng cuối. Mặc định "NEEDS WORK" cho tới khi có bằng chứng (caption, prompt, hoặc cấu trúc ảnh).`;
  const lines = [
    `## ${dept.label}`,
    "",
    "### Thành viên",
    "",
    "| Nhân vật | Chức vụ | Gọi bằng | Kỹ năng nền |",
    "|---|---|---|---|",
    ...rows,
    "",
    `### Quy trình ${lead.name} giao việc`,
    "",
    `Với yêu cầu lớn hoặc chưa rõ ai nên làm, người dùng gọi \`@${lead.rule}\` (${lead.name}). ${lead.name} làm theo các bước:`,
    "",
    "1. Hiểu yêu cầu, hỏi lại nếu thiếu thông tin quan trọng.",
    "2. Chọn một người chịu trách nhiệm chính (và tối đa hai người hỗ trợ), nói rõ lý do.",
    "3. Viết brief cho từng người: mục tiêu, phạm vi, điều kiện hoàn thành.",
    reviewStep,
    "6. Báo cáo lại người dùng: đã làm gì, bằng chứng, rủi ro còn lại, việc cần họ quyết.",
    "",
    "### Gợi ý định tuyến theo từ khóa",
    "",
    ...routing,
    `- Không khớp từ khóa nào: giao cho ${fallback?.name ?? lead.name}.`,
  ];
  if (dept.id === "social") {
    lines.push(
      "",
      "Các agent short-video (`marketing/marketing-tiktok-strategist.md`, `marketing/marketing-short-video-editing-coach.md`) đang ở kho. Chỉ nhắc tới chúng khi người dùng yêu cầu mở Reels hoặc TikTok.",
    );
  }
  return lines.join("\n");
}

function teamRule(departments, skillsById) {
  const security = departments.flatMap((dept) => dept.roster).find((member) => member.role === "security");
  const body = [
    "# Đội Anitech Agency",
    "",
    "Project này có hai phòng ban. Mỗi thành viên là một file rule riêng trong `.cursor/rules/`. Người dùng gọi thành viên bằng `@<tên-rule>` trong chat. Khi một thành viên được gọi, hãy trả lời đúng vai nhân vật đó, bằng tiếng Việt.",
    "",
    ...departments.map((dept) => departmentBlock(dept, skillsById)),
    "",
    "## Quy tắc chung",
    "",
    "- Không commit, push hay deploy khi người dùng chưa yêu cầu rõ.",
    "- Không có bằng chứng thì không coi là xong.",
    `- Việc đụng tới đăng nhập, phân quyền, dữ liệu nhạy cảm phải có ${security?.name ?? "người phụ trách bảo mật"} xem trước khi kiểm thử.`,
    "- Các file trong `.cursor/rules/` do `npm run sync:agents` sinh ra. Muốn đổi nội dung, sửa `agents/roster.json`, `agents/roster-social.json` hoặc `agents/personas/<id>.md` rồi chạy lại.",
  ].join("\n");
  return mdc({
    description: "Danh sách đội Anitech Agency, cách @mention từng nhân vật và quy trình trưởng phòng giao việc",
    alwaysApply: true,
    body,
  });
}

function loadDepartments(options) {
  const departments = [{ id: "it", label: "IT Research", roster: readRoster(options.rosterPath) }];
  if (options.rosterSocialPath && fs.existsSync(options.rosterSocialPath)) {
    departments.push({ id: "social", label: "Social Marketing", roster: readRoster(options.rosterSocialPath) });
  }
  const seen = { id: new Set(), rule: new Set() };
  for (const dept of departments) {
    for (const member of dept.roster) {
      for (const key of ["id", "rule"]) {
        if (seen[key].has(member[key])) throw new Error(`roster: duplicate ${key} "${member[key]}" across departments`);
        seen[key].add(member[key]);
      }
    }
  }
  return departments;
}

/**
 * @param {{rosterPath:string, rosterSocialPath?:string|null, personasDir:string, vendorDir:string, outDir:string, upstreamDir?:string|null}} options
 * @returns {{files:string[], copied:string[], usedUpstream:boolean}}
 */
export function syncAgents(options) {
  const { personasDir, vendorDir, outDir, upstreamDir } = options;
  const departments = loadDepartments(options);
  const roster = departments.flatMap((dept) => dept.roster);

  const usedUpstream = Boolean(upstreamDir) && fs.existsSync(upstreamDir);
  const copied = usedUpstream ? copyUpstream(roster, upstreamDir, vendorDir) : [];

  const skillsById = new Map(roster.map((member) => [member.id, loadSkills(member, vendorDir)]));
  fs.mkdirSync(outDir, { recursive: true });

  const files = [];
  const write = (name, content) => {
    fs.writeFileSync(path.join(outDir, name + ".mdc"), content);
    files.push(name + ".mdc");
  };

  write(TEAM_RULE, teamRule(departments, skillsById));
  for (const member of roster) {
    const personaPath = path.join(personasDir, member.id + ".md");
    if (!fs.existsSync(personaPath)) throw new Error(`Missing persona: ${personaPath}`);
    write(member.rule, memberRule(member, normalize(fs.readFileSync(personaPath, "utf8")), skillsById.get(member.id)));
  }
  return { files, copied, usedUpstream };
}

function main() {
  const paths = defaultPaths();
  const result = syncAgents(paths);
  console.log(
    result.usedUpstream
      ? `Upstream: ${paths.upstreamDir} (${result.copied.length} files copied to vendor/)`
      : `Upstream not found at ${paths.upstreamDir}; using pinned copy in vendor/`,
  );
  console.log(`Generated ${result.files.length} rules in ${path.relative(ROOT, paths.outDir)}:`);
  for (const file of result.files) console.log("  " + file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
