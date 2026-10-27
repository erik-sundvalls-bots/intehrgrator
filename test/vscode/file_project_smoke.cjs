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
exports.run = async () => {
  const steps = [];
  try {
    const extension = vscode.extensions.getExtension('regionstockholm.intehrgrator');
    if (!extension) throw new Error('Extension not found');
    await extension.activate();
    steps.push('extension activated');
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
    fs.writeFileSync(reportPath, JSON.stringify({ok:true,steps}, null, 2));
  } catch (error) {
    fs.writeFileSync(reportPath, JSON.stringify({ok:false,steps,error:String(error),stack:error.stack}, null, 2));
    throw error;
  }
};

