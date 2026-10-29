const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const root = process.env.INTEHRGRATOR_TEST_PROJECT;
const reportPath = path.join(root, 'test-result.json');
const waitFor = async (check, description) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { try { if (check()) return; } catch {} await new Promise(r => setTimeout(r, 200)); }
  throw new Error('Timed out: ' + description);
};
const openWorkbench = async () => {
  let timer;
  try {
    return await Promise.race([
      vscode.commands.executeCommand('intehrgrator.openWorkbench'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Open Workbench did not resume the remembered project')), 20000); }),
    ]);
  } finally { clearTimeout(timer); }
};
exports.run = async () => {
  const steps = [];
  try {
    const extension = vscode.extensions.getExtension('regionstockholm.intehrgrator');
    if (!extension) throw new Error('Extension not found');
    await extension.activate();
    steps.push('extension activated');
    if (process.env.INTEHRGRATOR_TEST_PHASE === 'restored') {
      const config = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'intehrgrator.json')));
      await waitFor(() => config.isDirty && JSON.parse(config.getText()).source.schema.languageSettings.labelLanguage === 'en', 'VS Code restores unsaved manifest language metadata');
      await vscode.workspace.saveAll(false);
      steps.push('unsaved language metadata survived hot exit and was saved after restart');
      const mappingUri = vscode.Uri.file(path.join(root, 'mapping/main.mapping.json')).toString();
      const restoredTab = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'intehrgrator.fileProject' && tab.input.uri.toString() === mappingUri);
      await openWorkbench();
      await waitFor(() => Boolean(restoredTab()), 'Open Workbench resumes the remembered file project after restart');
      steps.push('Open Workbench resumes the same project after a full VS Code restart');
      const result = path.join(root, 'output/examples/person-01.json');
      const source = path.join(root, 'source/person-01.json');
      fs.writeFileSync(source, JSON.stringify({id:'RESTARTED-ID',displayName:'After restart'}));
      await waitFor(() => JSON.parse(fs.readFileSync(result,'utf8')).identifier === 'RESTARTED-ID', 'restored view reads examples from disk');
      steps.push('restored project reloads source data from disk');
      await vscode.window.tabGroups.close(restoredTab());
      fs.unlinkSync(result);
      fs.writeFileSync(source, JSON.stringify({id:'REOPENED-ID',displayName:'After reopening'}));
      await openWorkbench();
      await waitFor(() => JSON.parse(fs.readFileSync(result,'utf8')).identifier === 'REOPENED-ID', 'reopening after restart rebinds the file project');
      steps.push('reopening after restart resumes the same file project');
      fs.writeFileSync(reportPath, JSON.stringify({ok:true,steps},null,2));
      return;
    }

    await openWorkbench();
    const opened = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(opened?.input instanceof vscode.TabInputCustom) || opened.input.viewType !== 'intehrgrator.fileProject') {
      throw new Error('Open Workbench reopened an unbound empty view instead of the existing file project: ' + opened?.label);
    }
    steps.push('Open Workbench found and loaded the existing file project');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await openWorkbench();
    const reopened = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(reopened?.input instanceof vscode.TabInputCustom) || reopened.input.viewType !== 'intehrgrator.fileProject') {
      throw new Error('Closing and reopening lost the file project binding');
    }
    steps.push('closing and reopening preserves the file project binding');

    await vscode.commands.executeCommand('intehrgrator.openFileProject', vscode.Uri.file(path.join(root, 'intehrgrator.json')));
    const result = path.join(root, 'output/examples/person-01.json');
    await waitFor(() => JSON.parse(fs.readFileSync(result, 'utf8')).identifier === 'EXAMPLE-12345', 'webview boot and initial output');
    steps.push('custom editor booted and generated initial output');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'mapping/main.mapping.json')));
    const original = document.getText();
    const mapping = JSON.parse(original);
    const block = mapping.blocklyState.blocks.blocks.find(b => b.type === 'conversion_start').next.block;
    delete block.inputs.TARGET_identifier;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(mapping, null, 2));
    await vscode.workspace.applyEdit(edit);
    await document.save();
    await waitFor(() => JSON.parse(fs.readFileSync(result, 'utf8')).identifier === undefined, 'saved mapping removes identifier');
    steps.push('saving mapping removes identifier from output');
    const restore = new vscode.WorkspaceEdit();
    restore.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), original);
    await vscode.workspace.applyEdit(restore);
    await document.save();
    await waitFor(() => JSON.parse(fs.readFileSync(result, 'utf8')).identifier === 'EXAMPLE-12345', 'restore mapping');
    const source = path.join(root, 'source/person-01.json');
    fs.writeFileSync(source, JSON.stringify({id: 'EXAMPLE-67890', displayName: 'Changed source'}));
    await waitFor(() => JSON.parse(fs.readFileSync(result, 'utf8')).identifier === 'EXAMPLE-67890', 'source folder watcher');
    steps.push('source changes regenerate output');
    let config = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'intehrgrator.json')));
    const initialConfig = config.getText();
    const withLanguage = JSON.parse(initialConfig);
    withLanguage.source.schema = { path: 'schemas/person.schema.json', languageSettings: { languages: [], labelLanguage: 'sv' } };
    const metadataEdit = new vscode.WorkspaceEdit();
    metadataEdit.replace(config.uri, new vscode.Range(0, 0, config.lineCount, 0), JSON.stringify(withLanguage, null, 2));
    metadataEdit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), document.getText() + '\n');
    await vscode.workspace.applyEdit(metadataEdit);
    if (!config.isDirty || !document.isDirty) throw new Error('Both project documents must be dirty before Save All');
    await vscode.window.showTextDocument(config);
    await vscode.commands.executeCommand('undo');
    await waitFor(() => typeof JSON.parse(config.getText()).source.schema === 'string', 'undo language metadata');
    await vscode.commands.executeCommand('redo');
    await waitFor(() => JSON.parse(config.getText()).source.schema.languageSettings.labelLanguage === 'sv', 'redo language metadata');
    await vscode.workspace.saveAll(false);
    if (JSON.parse(fs.readFileSync(config.uri.fsPath, 'utf8')).source.schema.languageSettings.labelLanguage !== 'sv') {
      throw new Error('Language metadata was not saved to the manifest');
    }
    steps.push('manifest language metadata has native dirty state, undo, redo and save');
    const configPath = config.uri.fsPath;
    const configTab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === config.uri.toString());
    if (!configTab || !await vscode.window.tabGroups.close(configTab)) throw new Error('Could not close the manifest editor');
    const externalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    externalConfig.output.script.path = 'output/refreshed.ts';
    fs.writeFileSync(configPath, JSON.stringify(externalConfig, null, 2));
    await waitFor(() => fs.existsSync(path.join(root, 'output/refreshed.ts')), 'external manifest edit after its document closed');
    config = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
    await vscode.window.showTextDocument(config);
    steps.push('closed manifest documents reopen and external configuration changes refresh artifacts');
    const script = path.join(root, 'output/conversion.ts');
    if (!fs.readFileSync(script, 'utf8').includes('convert')) throw new Error('Missing conversion code');
    // A second manifest makes rediscovery ambiguous; cold restart must use the remembered URI.
    const secondProject = path.join(root, 'another-project');
    fs.mkdirSync(secondProject, {recursive:true});
    fs.copyFileSync(path.join(root,'intehrgrator.json'), path.join(secondProject,'intehrgrator.json'));
    const pending = JSON.parse(config.getText());
    pending.source.schema.languageSettings.labelLanguage = 'en';
    const unsaved = new vscode.WorkspaceEdit();
    unsaved.replace(config.uri, new vscode.Range(0, 0, config.lineCount, 0), JSON.stringify(pending, null, 2));
    await vscode.workspace.applyEdit(unsaved);
    if (!config.isDirty) throw new Error('Expected unsaved language metadata before hot exit');
    steps.push('left language metadata unsaved for native hot-exit recovery');
    fs.writeFileSync(reportPath, JSON.stringify({ok:true,steps}, null, 2));
  } catch (error) {
    const documents = vscode.workspace.textDocuments.filter(doc => doc.uri.fsPath.startsWith(root)).map(doc => ({path:doc.uri.fsPath,dirty:doc.isDirty,closed:doc.isClosed,manifest:doc.uri.fsPath.endsWith('intehrgrator.json') ? doc.getText() : undefined}));
    fs.writeFileSync(reportPath, JSON.stringify({ok:false,steps,error:String(error),stack:error.stack,documents}, null, 2));
    throw error;
  }
};

