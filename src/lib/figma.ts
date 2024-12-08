interface Node {
  id: string;
}

export function findFrames(node: any): Node[] {
  const nodes = [];
  if (node.type === "FRAME") {
    nodes.push(node);
  }

  if (node.children) {
    for (const child of node.children) {
      nodes.push(...findFrames(child));
    }
  }

  return nodes;
}
