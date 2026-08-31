import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = [path.join('apps', 'server', 'src')];

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) acc.push(p);
  }
  return acc;
}

function isDbCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  const name = expr.name.text;
  if (!['get', 'all', 'run'].includes(name)) return false;
  let obj = expr.expression;
  if (ts.isIdentifier(obj) && (obj.text === 'app' || obj.text === 'Promise')) return false;
  return true;
}

function isAlreadyAwaited(node) {
  return node.parent && ts.isAwaitExpression(node.parent);
}

function transformFile(fileName, sourceText) {
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const transformer = (context) => {
    const { factory } = context;
    const visit = (node) => {
      node = ts.visitEachChild(node, visit, context);
      if (isDbCall(node) && !isAlreadyAwaited(node)) {
        return factory.createAwaitExpression(node);
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        [
          'withTx',
          'seedSystem',
          'isBootstrapped',
          'integrityCheck',
          'backupTo',
          'openDatabase',
        ].includes(node.expression.text) &&
        !isAlreadyAwaited(node)
      ) {
        return factory.createAwaitExpression(node);
      }
      return node;
    };

    const addAsync = (node) => {
      node = ts.visitEachChild(node, addAsync, context);
      const isFn =
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node);
      if (!isFn) return node;
      if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return node;
      let hasAwait = false;
      const scan = (n) => {
        if (ts.isAwaitExpression(n)) hasAwait = true;
        ts.forEachChild(n, scan);
      };
      if (node.body) scan(node.body);
      if (!hasAwait) return node;
      const mods = factory.createNodeArray([
        ...(node.modifiers ?? []),
        factory.createModifier(ts.SyntaxKind.AsyncKeyword),
      ]);
      if (ts.isFunctionDeclaration(node)) {
        return factory.updateFunctionDeclaration(
          node,
          mods,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          node.body,
        );
      }
      if (ts.isFunctionExpression(node)) {
        return factory.updateFunctionExpression(
          node,
          mods,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          node.body,
        );
      }
      if (ts.isArrowFunction(node)) {
        return factory.updateArrowFunction(
          node,
          mods,
          node.typeParameters,
          node.parameters,
          node.type,
          node.equalsGreaterThanToken,
          node.body,
        );
      }
      if (ts.isMethodDeclaration(node)) {
        return factory.updateMethodDeclaration(
          node,
          mods,
          node.asteriskToken,
          node.name,
          node.questionToken,
          node.typeParameters,
          node.parameters,
          node.type,
          node.body,
        );
      }
      return node;
    };

    return (root) => addAsync(visit(root));
  };

  const result = ts.transform(sf, [transformer]);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(result.transformed[0]);
}

for (const root of roots) {
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8');
    const out = transformFile(file, src);
    if (out !== src) {
      fs.writeFileSync(file, out);
      console.log('updated', file);
    }
  }
}
