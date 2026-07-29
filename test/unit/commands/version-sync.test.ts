import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyContractVersion,
  runVersionSync,
} from "../../../src/commands/version-sync.js";

const CONTRACT = `# comment stays
cli_contracts: 0.1.0

info:
  title: Example CLI
  version: 0.1.0
  description: >-
    Multi-line description whose formatting must survive.

command_sets:
  example:
    summary: Example.
    version: 9.9.9
    commands:
      run:
        summary: Run.
`;

describe("applyContractVersion", () => {
  it("rewrites only the info.version line", () => {
    const { current, content } = applyContractVersion(CONTRACT, "1.2.3");
    expect(current).toBe("0.1.0");
    expect(content).toContain("  version: 1.2.3\n");
    // every other line is untouched, including a same-named key elsewhere
    expect(content).toContain("    version: 9.9.9");
    expect(content.split("\n").length).toBe(CONTRACT.split("\n").length);
    const changed = content
      .split("\n")
      .filter((line, i) => line !== CONTRACT.split("\n")[i]);
    expect(changed).toEqual(["  version: 1.2.3"]);
  });

  it("leaves the document untouched when already in sync", () => {
    const { current, content } = applyContractVersion(CONTRACT, "0.1.0");
    expect(current).toBe("0.1.0");
    expect(content).toBe(CONTRACT);
  });

  it("reports no version when the info block has none", () => {
    const { current } = applyContractVersion("info:\n  title: T\n", "1.0.0");
    expect(current).toBeUndefined();
  });
});

describe("runVersionSync", () => {
  let dir: string;
  let contractPath: string;
  let packagePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cli-contracts-version-sync-"));
    contractPath = join(dir, "cli-contract.yaml");
    packagePath = join(dir, "package.json");
    await writeFile(contractPath, CONTRACT, "utf-8");
    await writeFile(packagePath, JSON.stringify({ version: "2.5.0" }), "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the package version into the contract", async () => {
    const result = await runVersionSync([contractPath], {
      packageFile: packagePath,
    });

    expect(result.packageVersion).toBe("2.5.0");
    expect(result.inSync).toBe(false);
    expect(result.files[0].status).toBe("updated");
    expect(await readFile(contractPath, "utf-8")).toContain("  version: 2.5.0");
  });

  it("is idempotent", async () => {
    await runVersionSync([contractPath], { packageFile: packagePath });
    const second = await runVersionSync([contractPath], {
      packageFile: packagePath,
    });

    expect(second.inSync).toBe(true);
    expect(second.files[0].status).toBe("in-sync");
  });

  it("check mode reports the mismatch without writing", async () => {
    const result = await runVersionSync([contractPath], {
      packageFile: packagePath,
      check: true,
    });

    expect(result.checked).toBe(true);
    expect(result.inSync).toBe(false);
    expect(result.files[0].status).toBe("out-of-sync");
    expect(result.files[0].contractVersion).toBe("0.1.0");
    expect(await readFile(contractPath, "utf-8")).toBe(CONTRACT);
  });

  it("check mode passes once the versions match", async () => {
    await writeFile(packagePath, JSON.stringify({ version: "0.1.0" }), "utf-8");
    const result = await runVersionSync([contractPath], {
      packageFile: packagePath,
      check: true,
    });

    expect(result.inSync).toBe(true);
  });

  it("rejects a contract file without info.version", async () => {
    await writeFile(contractPath, "info:\n  title: T\n", "utf-8");
    await expect(
      runVersionSync([contractPath], { packageFile: packagePath }),
    ).rejects.toThrow("no info.version");
  });

  it("rejects a package file without a version", async () => {
    await writeFile(packagePath, JSON.stringify({ name: "x" }), "utf-8");
    await expect(
      runVersionSync([contractPath], { packageFile: packagePath }),
    ).rejects.toThrow("no version field");
  });
});
