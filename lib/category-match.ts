export type CategoryOption = { id: string; name: string; parent_id: string | null };

export function categoryPaths(categories: CategoryOption[]): { id: string; path: string }[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  return categories.map(category => {
    const parent = category.parent_id ? byId.get(category.parent_id) : null;
    return { id: category.id, path: parent ? `${parent.name} / ${category.name}` : category.name };
  });
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
