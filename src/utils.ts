import fetch from "node-fetch";
import * as path from "path";
import * as fs from "fs-extra";
import * as prettier from "prettier";

import * as ts from "typescript";
import { ResolveConfigOptions } from "prettier";
import { CodeGenerator } from "./generate";
import { debug } from "util";
import { error } from "./debugLog";

export class Config {
  originUrl?= "";
  usingOperationId: boolean;
  taggedByName = true;
  outDir = "service";
  origins?= [] as Array<{
    originUrl: string;
    name: string;
    usingOperationId: boolean;
  }>;
  templatePath = "serviceTemplate";
  prettierConfig: ResolveConfigOptions;

  constructor(config: Config) {
    Object.keys(config).forEach(key => (this[key] = config[key]));
  }

  validate() {
    if (this.origins && this.origins.length) {
      this.origins.forEach((origin, index) => {
        if (!origin.originUrl) {
          return `请在 origins[${index}] 中配置 originUrl `;
        }
        if (!origin.name) {
          return `请在 origins[${index}] 中配置 originUrl `;
        }
      });
    } else {
      if (!this.originUrl) {
        return "请配置 originUrl 来指定远程地址。";
      }
    }

    return "";
  }

  static createFromConfigPath(configPath: string) {
    const content = fs.readFileSync(configPath, "utf8");

    try {
      const configObj = JSON.parse(content);

      return new Config(configObj);
    } catch (e) {
      throw new Error("pont-config.json is not a validate json");
    }
  }

  getDataSourcesConfig(configDir: string) {
    const commonConfig = {
      usingOperationId: this.usingOperationId,
      taggedByName: this.taggedByName,
      outDir: path.join(configDir, this.outDir),
      templatePath: path.join(configDir, this.templatePath),
      prettierConfig: this.prettierConfig
    };

    if (this.origins && this.origins.length) {
      return this.origins.map(origin => {
        return new DataSourceConfig({
          ...commonConfig,
          ...origin
        });
      });
    }

    return [
      new DataSourceConfig({
        ...commonConfig,
        originUrl: this.originUrl
      })
    ];
  }
}

export class DataSourceConfig {
  originUrl: string;
  name?: string;
  usingOperationId = false;
  taggedByName = true;
  templatePath = "serviceTemplate";
  outDir = "src/service";
  prettierConfig: ResolveConfigOptions = {};

  constructor(config: DataSourceConfig) {
    Object.keys(config).forEach(key => {
      this[key] = config[key];
    });
  }
}

function wait(timeout = 100) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

export function format(fileContent: string, prettierOpts = {}) {
  // return fileContent;
  try {
    return prettier.format(fileContent, {
      parser: "typescript",
      trailingComma: "all",
      singleQuote: true,
      ...prettierOpts
    });
  } catch (e) {
    error(`代码格式化报错！${e.toString()}\n代码为：${fileContent}`);
    return fileContent;
  }
  // try {
  //   await wait(Math.random() * 100);
  //   return prettier.format(fileContent, {
  //     parser: "typescript",
  //     trailingComma: "all",
  //     singleQuote: true,
  //     ...prettierOpts
  //   });
  // } catch (e) {
  //   console.log("prettier format 错误", fileContent, e);
  //   return format(fileContent, prettierOpts);
  // }
}

export function getDuplicateById<T>(arr: T[], idKey = "name"): null | T {
  if (!arr || !arr.length) {
    return null;
  }

  let result;

  arr.forEach((item, itemIndex) => {
    if (arr.slice(0, itemIndex).find(o => o[idKey] === item[idKey])) {
      result = item;
      return;
    }
  });

  return result;
}

export function transformCamelCase(name: string) {
  let words = [] as string[];

  if (name.includes('-')) {
    words = name.split('-');
  } else if (name.includes(' ')) {
    words = name.split(' ');
  }

  const newName = words.map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join('');

  return newName.charAt(0).toLowerCase() + newName.slice(1);
}

export function transformDescription(description: string) {
  const words = description.split(" ").filter(word => word !== "Controller");

  const [firstWord, ...rest] = words;
  const sFirstWord = firstWord.charAt(0).toLowerCase() + firstWord.slice(1);

  return [sFirstWord, ...rest].join("");
}

export function toUpperFirstLetter(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function getMaxSamePath(paths: string[], samePath = "") {
  if (!paths.length) {
    return samePath;
  }

  if (paths.some(path => !path.includes("/"))) {
    return samePath;
  }

  const segs = paths.map(path => {
    const [firstSeg, ...restSegs] = path.split("/");
    return { firstSeg, restSegs };
  });

  if (
    segs.every(
      (seg, index) => index === 0 || seg.firstSeg === segs[index - 1].firstSeg
    )
  ) {
    return getMaxSamePath(
      segs.map(seg => seg.restSegs.join("/")),
      samePath + "/" + segs[0].firstSeg
    );
  }

  return samePath;
}

export function getIdentifierFromUrl(
  url: string,
  requestType: string,
  samePath = ""
) {
  const currUrl = url.slice(samePath.length).match(/([^\.]+)/)[0];

  return (
    requestType +
    currUrl
      .split("/")
      .map(str => {
        if (str.match(/^{.+}$/gim)) {
          return "By" + toUpperFirstLetter(str.slice(1, str.length - 1));
        }
        return toUpperFirstLetter(str);
      })
      .join("")
  );
}

/** some reversed keyword in js but not in java */
const TS_KEYWORDS = ["delete"];
const REPLACE_WORDS = ["remove"];

export function getIdentifierFromOperatorId(operationId: string) {
  const identifier = operationId.replace(/(.+)(Using.+)/, "$1");

  const index = TS_KEYWORDS.indexOf(identifier);

  if (index === -1) {
    return identifier;
  }

  return REPLACE_WORDS[index];
}

export function getTemplate(templatePath): typeof CodeGenerator {
  const tsResult = fs.readFileSync(templatePath + ".ts", "utf8");
  const jsResult = ts.transpileModule(tsResult, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.CommonJS
    }
  });

  const noCacheFix = (Math.random() + "").slice(2, 5);
  const jsName = templatePath + noCacheFix + ".js";
  fs.writeFileSync(jsName, jsResult.outputText, "utf8");

  const moduleResule = require(jsName).default;

  fs.removeSync(jsName);

  return moduleResule;
}

export async function lookForFiles(
  dir: string,
  fileName: string
): Promise<string> {
  const files = await fs.readdir(dir);

  for (let file of files) {
    const currName = path.join(dir, file);

    const info = await fs.lstat(currName);

    if (info.isDirectory()) {
      if (file === ".git" || file === "node_modules") {
        continue;
      }

      const result = await lookForFiles(currName, fileName);

      if (result) {
        return result;
      }
    } else if (info.isFile() && file === fileName) {
      return currName;
    }
  }
}

export function toDashCase(name: string) {
  const dashName = name.split(' ').join('').replace(/[A-Z]/g, p => "-" + p.toLowerCase());

  if (dashName.startsWith("-")) {
    return dashName.slice(1);
  }

  return dashName;
}

export function toDashDefaultCase(name: string) {
  let dashName = name.split(' ').join('').replace(/[A-Z]/g, p => "-" + p.toLowerCase());

  if (dashName.startsWith("-")) {
    dashName = dashName.slice(1);
  }

  if (dashName.endsWith('-controller')) {
    return dashName.slice(0, dashName.length - '-controller'.length);
  }

  return dashName;
}

/** 正则检测是否包含中文名 */
export function hasChinese(str: string){
  return str && str.match(
    /[\u4E00-\u9FCC\u3400-\u4DB5\uFA0E\uFA0F\uFA11\uFA13\uFA14\uFA1F\uFA21\uFA23\uFA24\uff1a\uff0c\uFA27-\uFA29]|[\ud840-\ud868][\udc00-\udfff]|\ud869[\udc00-\uded6\udf00-\udfff]|[\ud86a-\ud86c][\udc00-\udfff]|\ud86d[\udc00-\udf34\udf40-\udfff]|\ud86e[\udc00-\udc1d]|[\uff01-\uff5e\u3000-\u3009\u2026]/
  );
}