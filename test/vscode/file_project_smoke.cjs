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
    const script = path.join(root, 'output/conversion.ts');
    if (!fs.readFileSync(script, 'utf8').includes('convert')) throw new Error('Missing conversion code');
    // A second manifest makes rediscovery ambiguous; cold restart must use the remembered URI.
    const secondProject = path.join(root, 'another-project');
    fs.mkdirSync(secondProject, {recursive:true});
    fs.copyFileSync(path.join(root,'intehrgrator.json'), path.join(secondProject,'intehrgrator.json'));
    fs.writeFileSync(reportPath, JSON.stringify({ok:true,steps}, null, 2));
  } catch (error) {
    fs.writeFileSync(reportPath, JSON.stringify({ok:false,steps,error:String(error),stack:error.stack}, null, 2));
    throw error;
  }
};

