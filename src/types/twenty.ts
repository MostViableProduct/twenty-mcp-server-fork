export interface TwentyConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FullName {
  firstName: string;
  lastName: string;
}

export interface Emails {
  primaryEmail: string;
  additionalEmails?: string[];
}

export interface Phones {
  primaryPhoneNumber?: string;
  primaryPhoneCountryCode?: string;
  additionalPhones?: any[];
}

export interface Links {
  primaryLinkUrl?: string;
  primaryLinkLabel?: string;
  secondaryLinks?: any[];
}

export interface Address {
  addressStreet1?: string;
  addressStreet2?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  addressPostcode?: string;
}

export interface Currency {
  amountMicros?: number;
  currencyCode?: string;
}

export interface Person {
  id?: string;
  name: FullName;
  emails?: Emails;
  phones?: Phones;
  companyId?: string;
  jobTitle?: string;
  linkedinLink?: Links;
  xLink?: Links;
  city?: string;
  avatarUrl?: string;
}

export interface Company {
  id?: string;
  name: string;
  domainName?: Links;
  address?: Address;
  employees?: number;
  linkedinLink?: Links;
  xLink?: Links;
  annualRecurringRevenue?: Currency;
  idealCustomerProfile?: boolean;
  accountOwnerId?: string;
}

// Twenty v2.x replaced the plaintext `body` field on Note/Task with a
// RichText object addressed as `bodyV2`. We accept a plain `body` string
// at the type boundary (ergonomic) and map it to `{ markdown }` in the
// client. `bodyV2` is also accepted directly for callers that want to
// supply blocknote.
export interface RichTextInput {
  markdown?: string;
  blocknote?: string;
}

export interface Task {
  id?: string;
  title: string;
  body?: string;
  bodyV2?: RichTextInput;
  dueAt?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId?: string;
}

export interface Note {
  id?: string;
  title?: string;
  body?: string;
  bodyV2?: RichTextInput;
  authorId?: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}