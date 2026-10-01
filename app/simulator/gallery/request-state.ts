import type { Publication } from '../api';

type Reactions = Pick<Publication, 'likes' | 'favorites' | 'liked' | 'favorited'>;
const reactions = ({ likes, favorites, liked, favorited }: Publication): Reactions => ({ likes, favorites, liked, favorited });

/** Per-mounted-member ordering for overlapping list/detail reads and writes. */
export class GalleryRequestState {
  private version = 0;
  private observations = new Map<string, { version: number; reactions: Reactions }>();
  private reads = new Map<number, string | undefined>();
  private retained = new Set<string>();

  beginRead(publicationId?: string): number {
    const version = ++this.version;
    this.reads.set(version, publicationId);
    return version;
  }

  finishRead(version: number) { this.reads.delete(version); this.prune(); }

  retain(publicationIds: Iterable<string>) { this.retained = new Set(publicationIds); this.prune(); }

  private prune() {
    for (const [id, observation] of this.observations) {
      const protectsPendingRead = [...this.reads].some(([startedAt, target]) => startedAt < observation.version && (target === undefined || target === id));
      if (!this.retained.has(id) && !protectsPendingRead) this.observations.delete(id);
    }
  }

  clear() { this.observations.clear(); this.reads.clear(); this.retained.clear(); }

  get retainedCount(): number { return this.observations.size; }

  acceptRead(publication: Publication, startedAt: number): Publication {
    const newer = this.observations.get(publication.id);
    // The GET may have captured its server snapshot before a successful POST,
    // or before a newer GET. Keep that newer reaction state in both views.
    if (newer && newer.version > startedAt) return { ...publication, ...newer.reactions };
    this.observations.set(publication.id, { version: startedAt, reactions: reactions(publication) });
    return publication;
  }

  acknowledgeMutation(publication: Publication): Publication {
    this.observations.set(publication.id, { version: ++this.version, reactions: reactions(publication) });
    return publication;
  }

  current(publication: Publication): Publication {
    const latest = this.observations.get(publication.id);
    return latest ? { ...publication, ...latest.reactions } : publication;
  }
}
