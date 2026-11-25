export type CategoryOption = { id: string; name: string; parent_id: string | null };

export function categoryPaths(categories: CategoryOption[]): { id: string; path: string }[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  function pathFor(category: CategoryOption, seen: Set<string>): string {
    if (!category.parent_id || seen.has(category.id)) return category.name;
    const parent = byId.get(category.parent_id);
    if (!parent) return category.name;
    seen.add(category.id);
    return `${pathFor(parent, seen)} / ${category.name}`;
  }
  return categories.map(category => ({ id: category.id, path: pathFor(category, new Set()) }));
}

export function matchCategoryId(selected: string | undefined, categories: CategoryOption[]): string | null {
  if (!selected) return null;
  const normalize = (value: string) => value.replace(/\s*[／/]\s*/g, " / ").trim().toLocaleLowerCase();
  const paths = categoryPaths(categories);
  const exact = paths.find(option => normalize(option.path) === normalize(selected));
  if (exact) return exact.id;
  const leafMatches = categories.filter(category => normalize(category.name) === normalize(selected));
  return leafMatches.length === 1 ? leafMatches[0].id : null;
}
