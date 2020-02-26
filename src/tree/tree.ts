import { isLocalRef, pointerToPath } from '@stoplight/json';
import { Tree, TreeListParentNode, TreeState } from '@stoplight/tree-list';
import { JsonPath, Optional } from '@stoplight/types';
import { JSONSchema4 } from 'json-schema';
import { get as _get, isEqual as _isEqual, isObject as _isObject } from 'lodash';
import { isRefNode } from '../utils/guards';
import { getNodeMetadata, metadataStore } from './metadata';
import { canStepIn } from './utils/canStepIn';
import { populateTree } from './utils/populateTree';

export type SchemaTreeRefDereferenceFn = (path: JsonPath, schema: JSONSchema4) => Optional<JSONSchema4>;

export type SchemaTreeOptions = {
  expandedDepth: number;
  mergeAllOf: boolean;
  resolveRef: Optional<SchemaTreeRefDereferenceFn>;
};

export { TreeState as SchemaTreeState };

export class SchemaTree extends Tree {
  public expandedDepth: number;
  public mergeAllOf: boolean;
  protected resolveRef: Optional<SchemaTreeRefDereferenceFn>;

  constructor(public schema: JSONSchema4, public state: TreeState, opts: SchemaTreeOptions) {
    super();

    this.expandedDepth = opts.expandedDepth;
    this.mergeAllOf = opts.mergeAllOf;
    this.resolveRef = opts.resolveRef;
  }

  protected readonly visited = new WeakSet();

  public populate() {
    const expanded = {};
    populateTree(this.schema, this.root, 0, [], {
      mergeAllOf: this.mergeAllOf,
      onNode: (fragment, node, parentTreeNode, level): boolean => {
        if (isRefNode(node) && node.$ref !== null && isLocalRef(node.$ref)) {
          expanded[node.id] = false;
        }

        const metadata = metadataStore.get(parentTreeNode);

        if (metadata !== void 0 && isRefNode(metadata.schemaNode)) return false;
        return level <= this.expandedDepth + 1;
      },
    });
    this.state.expanded = expanded;
    this.invalidate();
  }

  public populateTreeFragment(parent: TreeListParentNode, schema: JSONSchema4, path: JsonPath, stepIn: boolean) {
    const initialLevel = Tree.getLevel(parent);
    const artificialRoot = Tree.createArtificialRoot();
    populateTree(schema, artificialRoot, initialLevel, path, {
      mergeAllOf: this.mergeAllOf,
      onNode: (fragment, node, parentTreeNode, level) => {
        if (level <= this.expandedDepth || level <= initialLevel) return true;
        return stepIn && level <= initialLevel + 1 && canStepIn(getNodeMetadata(parentTreeNode).schema);
      },
    });

    if (artificialRoot.children.length === 0) {
      throw new Error(`Could not expand node ${path.join('.')}`);
    }

    this.insertTreeFragment(stepIn ? this.stepIn(artificialRoot, parent) : artificialRoot.children, parent);
  }

  protected stepIn(root: TreeListParentNode, parent: TreeListParentNode) {
    if (
      root.children.length > 0 &&
      'children' in root.children[0] &&
      _isEqual(getNodeMetadata(parent).path, getNodeMetadata(root.children[0]).path)
    ) {
      return root.children[0].children;
    }

    return root.children;
  }

  public unwrap(node: TreeListParentNode) {
    if (node.children.length !== 0 || this.visited.has(node)) {
      return super.unwrap(node);
    }

    const metadata = getNodeMetadata(node);
    const { path, schemaNode, schema } = metadata;
    if (!isRefNode(schemaNode)) {
      this.populateTreeFragment(node, schema, path, true);
    } else if (schemaNode.$ref !== null) {
      const refPath = pointerToPath(schemaNode.$ref);
      const schemaFragment = this.resolveRef ? this.resolveRef(refPath, this.schema) : _get(this.schema, refPath);
      if (!_isObject(schemaFragment)) {
        throw new ReferenceError(`Could not dereference ${refPath.join('.')}`);
      }

      this.populateTreeFragment(node, schemaFragment, path, false);
    } else {
      throw new Error(`I do know not how not expand node ${path.join('.')}`);
    }

    this.visited.add(node);
    return super.unwrap(node);
  }
}
