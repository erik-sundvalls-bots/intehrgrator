let extension;
const load = () => extension ??= import("./extension.mjs");
exports.activate = async (context) => (await load()).activate(context);
exports.deactivate = async () => extension ? (await extension).deactivate() : undefined;
