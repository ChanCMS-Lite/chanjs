import path from "path";

/** 路径配置：项目常用路径访问器（getter 动态计算，避免快照不同步） */
export const Paths = {
  rootPath: process.cwd(),
};

Object.defineProperties(Paths, {
  appPath:     { get() { return path.join(this.rootPath, "app"); } },
  configPath:  { get() { return path.join(this.rootPath, "config"); } },
  publicPath:  { get() { return path.join(this.rootPath, "public"); } },
  modulesPath: { get() { return path.join(this.appPath, "modules"); } },
  commonPath:  { get() { return path.join(this.appPath, "common"); } },
  helperPath:  { get() { return path.join(this.appPath, "helper"); } },
  extendPath:  { get() { return path.join(this.appPath, "extend"); } },
});

export default Paths;
