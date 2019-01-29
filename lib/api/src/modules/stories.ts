import mergeWith from 'lodash.mergewith';
import isEqual from 'lodash.isequal';
import toId, { sanitize } from '../lib/id';

import { Module } from '../index';

const merge = (a: any, b: any) =>
  mergeWith({}, a, b, (objValue: any, srcValue: any) => {
    if (Array.isArray(srcValue) && Array.isArray(objValue)) {
      srcValue.forEach(s => {
        const existing = objValue.find(o => o === s || isEqual(o, s));
        if (!existing) {
          objValue.push(s);
        }
      });

      return objValue;
    }
    if (Array.isArray(objValue)) {
      // eslint-disable-next-line no-console
      console.log('the types mismatch, picking', objValue);
      return objValue;
    }
    return undefined;
  });

type Direction = -1 | 1;
type StoryId = string;
type ParameterName = string;

interface SeparatorOptions {
  rootSeparator: RegExp;
  groupSeparator: RegExp;
}

interface Group {
  id: StoryId;
  name: string;
  children: StoryId[];
  parent: StoryId;
  depth: number;
  isComponent: boolean;
  isRoot: boolean;
}

interface StoryInput {
  id: StoryId;
  name: string;
  kind: string;
  children: string[];
  parameters: {
    filename: string;
    options: {
      hierarchyRootSeparator: RegExp;
      hierarchySeparator: RegExp;
      [key: string]: any;
    };
    [parameterName: string]: any;
  };
}

type Story = StoryInput & Group;

export interface StoriesHash {
  [id: string]: Group | Story;
}
export type StoriesList = Array<Group | Story>;
export type GroupsList = Group[];

interface StoriesRaw {
  [id: string]: StoryInput;
}

const initStoriesApi = ({
  store,
  navigate,
  storyId: initialStoryId,
  viewMode: initialViewMode,
}: Module) => {
  const isStory = (obj: Group | Story): boolean => {
    const story = obj as Story;
    return !!(story && story.parameters);
  };
  const jumpToStory = (direction: Direction) => {
    const { storiesHash, viewMode, storyId } = store.getState();

    // cannot navigate when there's no current selection
    if (!storyId || !storiesHash[storyId]) {
      return;
    }

    const lookupList = Object.keys(storiesHash).filter(
      k => !(storiesHash[k].children || Array.isArray(storiesHash[k]))
    );
    const index = lookupList.indexOf(storyId);

    // cannot navigate beyond fist or last
    if (index === lookupList.length - 1 && direction > 0) {
      return;
    }
    if (index === 0 && direction < 0) {
      return;
    }

    const result = lookupList[index + direction];

    if (viewMode && result) {
      navigate(`/${viewMode}/${result}`);
    }
  };

  const getData = (storyId: StoryId) => {
    const { storiesHash } = store.getState();

    return storiesHash[storyId];
  };

  const getParameters = (storyId: StoryId, parameterName?: ParameterName) => {
    const data = getData(storyId);

    if (isStory(data)) {
      const { parameters } = data as Story;
      return parameterName ? parameters[parameterName] : parameters;
    }

    return null;
  };

  const jumpToComponent = (direction: Direction) => {
    const state = store.getState();
    const { storiesHash, viewMode, storyId } = state;

    // cannot navigate when there's no current selection
    if (!storyId || !storiesHash[storyId]) {
      return;
    }

    const lookupList = Object.entries(storiesHash).reduce((acc, i) => {
      const value = i[1];
      if (value.isComponent) {
        acc.push([...i[1].children]);
      }
      return acc;
    }, []);

    const index = lookupList.findIndex(i => i.includes(storyId));

    // cannot navigate beyond fist or last
    if (index === lookupList.length - 1 && direction > 0) {
      return;
    }
    if (index === 0 && direction < 0) {
      return;
    }

    const result = lookupList[index + direction][0];

    navigate(`/${viewMode || 'story'}/${result}`);
  };

  const splitPath = (kind: string, { rootSeparator, groupSeparator }: SeparatorOptions) => {
    const [root, remainder] = kind.split(rootSeparator, 2);
    const groups = (remainder || kind).split(groupSeparator).filter(i => !!i);

    // when there's no remainder, it means the root wasn't found/split
    return {
      root: remainder ? root : null,
      groups,
    };
  };

  const toKey = (input: string) =>
    input.replace(/[^a-z0-9]+([a-z0-9])/gi, (...params) => params[1].toUpperCase());

  const toGroup = (name: string) => ({
    name,
    id: toKey(name),
  });

  const setStories = (input: StoriesRaw) => {
    const hash: StoriesHash = {};
    const storiesHash = Object.values(input).reduce((acc, item) => {
      const { kind, parameters } = item;
      const {
        hierarchyRootSeparator: rootSeparator,
        hierarchySeparator: groupSeparator,
      } = parameters.options;

      const { root, groups } = splitPath(kind, { rootSeparator, groupSeparator });

      const rootAndGroups = []
        .concat(root || [])
        .concat(groups)
        .map(toGroup)
        // Map a bunch of extra fields onto the groups, collecting the path as we go (thus the reduce)
        .reduce(
          (soFar, group, index, original) => {
            const { name } = group;
            const parent = index > 0 && soFar[index - 1].id;
            const id = sanitize(parent ? `${parent}-${name}` : name);

            const result: Group = {
              ...group,
              id,
              parent,
              depth: index,
              children: [],
              isComponent: index === original.length - 1,
              isRoot: !!root && index === 0,
            };
            return soFar.concat([result]);
          },
          [] as GroupsList
        );

      const paths = [...rootAndGroups.map(g => g.id), item.id];

      // Ok, now let's add everything to the store
      rootAndGroups.forEach((group, index) => {
        const child = paths[index + 1];
        const { id } = group;
        acc[id] = merge(acc[id] || {}, {
          ...group,
          ...(child && { children: [child] }),
        });
      });

      const story = { ...item, parent: rootAndGroups[rootAndGroups.length - 1].id };
      acc[item.id] = story as Story;

      return acc;
    }, hash);

    const { storyId, viewMode } = store.getState();

    if (!storyId || !storiesHash[storyId]) {
      // when there's no storyId or the storyId item doesn't exist
      // we pick the first leaf and navigate
      const firstLeaf = Object.values(storiesHash).find(s => !s.children);

      if (viewMode && firstLeaf) {
        navigate(`/${viewMode}/${firstLeaf.id}`);
      }
    }

    store.setState({ storiesHash });
  };

  const selectStory = (kindOrId: string, story?: string) => {
    const { viewMode = 'story', storyId } = store.getState();
    if (!story) {
      navigate(`/${viewMode}/${kindOrId}`);
    } else if (!kindOrId) {
      // This is a slugified version of the kind, but that's OK, our toId function is idempotent
      const kind = storyId.split('--', 2)[0];
      selectStory(toId(kind, story));
    } else {
      selectStory(toId(kindOrId, story));
    }
  };

  return {
    api: {
      storyId: toId,
      selectStory,
      setStories,
      jumpToComponent,
      jumpToStory,
      getData,
      getParameters,
    },
    state: {
      storiesHash: {},
      storyId: initialStoryId,
      viewMode: initialViewMode,
    },
  };
};
export default initStoriesApi;
