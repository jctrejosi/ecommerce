import { useMemo, useState, type ReactElement } from 'react'
import type { Category } from './types'

/**
 * Árbol de categorías para asociarlas a una estantería.
 *
 * Las categorías llegan planas (con `parentId`/`level`); aquí se reconstruye la
 * jerarquía para que las hijas se lean claramente: una guía vertical por nivel,
 * chevron para contraer/expandir y el nombre del padre en un tono más fuerte
 * que el de sus descendientes.
 */

interface TreeNode extends Category {
  children: TreeNode[]
}

/** Reconstruye el bosque (puede haber varias raíces) respetando el orden recibido. */
function buildTree(categories: Category[]): TreeNode[] {
  const nodes = new Map<number, TreeNode>()
  for (const c of categories) nodes.set(c.id, { ...c, children: [] })
  const roots: TreeNode[] = []
  for (const c of categories) {
    const node = nodes.get(c.id)!
    const parent = c.parentId != null ? nodes.get(c.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Deja sólo las ramas que coinciden con la búsqueda (o que contienen coincidencias). */
function pruneTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes
  const result: TreeNode[] = []
  for (const n of nodes) {
    const children = pruneTree(n.children, query)
    if (n.name.toLowerCase().includes(query) || children.length > 0) {
      result.push({ ...n, children })
    }
  }
  return result
}

export function CategoryTree({
  categories,
  selectedIds,
  onToggle,
  query = '',
  emptyLabel = 'Sin resultados.',
}: {
  categories: Category[]
  selectedIds: number[]
  /** Se llama al marcar/desmarcar (el padre decide si pide confirmación). */
  onToggle: (category: Category) => void
  query?: string
  emptyLabel?: string
}) {
  const q = query.trim().toLowerCase()
  const roots = useMemo(() => pruneTree(buildTree(categories), q), [categories, q])
  // Sólo guardamos las contraídas; por defecto todo expandido (el árbol es corto).
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())

  const toggleCollapsed = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderNodes = (nodes: TreeNode[]): ReactElement[] =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0
      // Con búsqueda activa siempre se expande, para no esconder las coincidencias.
      const expanded = q ? true : !collapsed.has(node.id)
      const checked = selectedIds.includes(node.id)
      const isParent = hasChildren || node.level === 0
      return (
        <div key={node.id}>
          <div className="flex items-center">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(node.id)}
                aria-label={`${expanded ? 'Contraer' : 'Expandir'} ${node.name}`}
                className="w-6 h-7 shrink-0 flex items-center justify-center text-white/40 hover:text-white"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                >
                  <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="w-6 h-7 shrink-0 flex items-center justify-center">
                <span className="w-1 h-1 rounded-full bg-white/25" />
              </span>
            )}
            <button
              type="button"
              onClick={() => onToggle(node)}
              className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm hover:bg-white/5 ${
                checked ? 'text-amber-300' : isParent ? 'text-white/80' : 'text-white/60'
              }`}
            >
              <span
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  checked ? 'bg-amber-400 border-amber-400 text-on-accent' : 'border-white/25'
                }`}
              >
                {checked ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span className={`truncate ${isParent ? 'font-semibold' : ''}`}>{node.name}</span>
            </button>
          </div>
          {hasChildren && expanded && (
            <div className="ml-[11px] border-l border-white/10">{renderNodes(node.children)}</div>
          )}
        </div>
      )
    })

  if (roots.length === 0) {
    return <p className="px-3 py-4 text-center text-white/30 text-xs">{emptyLabel}</p>
  }

  return <>{renderNodes(roots)}</>
}
