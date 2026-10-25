import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { DataExport } from '../data-export/data-export';
import { DeleteAccount } from '../delete-account/delete-account';

// "Contul tău", the last panel of the driver's Setări: a copy of the data,
// then the way to delete the account.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataExport, DeleteAccount, TranslatePipe],
  selector: 'mf-account-panel',
  styleUrl: './account-panel.css',
  templateUrl: './account-panel.html',
})
export class AccountPanel {}
